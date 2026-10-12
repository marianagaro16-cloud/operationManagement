'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { sendToUsers } from './push';
import type { ActionResult } from './actions';

/*
 * Quick note mutations. RLS holds the rules: only the owner changes a note,
 * whoever it is shared with may only tick its lines.
 */

const uuid = z.string().uuid();

const saveSchema = z
  .object({
    id: uuid.nullable(),
    body: z.string().max(4000).transform((v) => v.trim()),
    items: z.array(z.object({ body: z.string().trim().min(1).max(300), done: z.boolean() })).max(100),
    customer_id: uuid.nullable(),
    share_ids: z.array(uuid).max(50),
  })
  .refine((v) => v.body.length > 0 || v.items.length > 0, { message: 'note_empty' });

export type SaveNoteInput = z.input<typeof saveSchema>;

function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security') || error.message.includes('not_authorized')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: error.message };
}

function revalidate(customerId?: string | null) {
  // The notes are listed in the workspace's side list.
  revalidatePath('/space', 'layout');
  revalidatePath('/dashboard');
  if (customerId) revalidatePath(`/sales/customers/${customerId}`);
}

export async function saveNote(input: SaveNoteInput): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message === 'note_empty' ? 'note_empty' : 'invalid' };
  const { id, body, items, customer_id, share_ids } = parsed.data;
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) return { ok: false, error: 'not_authorized' };

  let noteId = id;
  let before: string[] = [];
  let oldCustomer: string | null = null;
  if (noteId) {
    const { data: old } = await supabase.from('quick_notes').select('owner_id, customer_id, shares:quick_note_shares ( profile_id )').eq('id', noteId).maybeSingle();
    if (!old || old.owner_id !== me) return { ok: false, error: 'not_authorized' };
    before = (old.shares ?? []).map((s) => s.profile_id);
    oldCustomer = old.customer_id;
    const { error } = await supabase.from('quick_notes').update({ body, customer_id }).eq('id', noteId);
    if (error) return fail(error);
    const { error: delError } = await supabase.from('quick_note_items').delete().eq('note_id', noteId);
    if (delError) return fail(delError);
  } else {
    const { data, error } = await supabase.from('quick_notes').insert({ body, customer_id }).select('id').single();
    if (error) return fail(error);
    noteId = data.id;
  }

  if (items.length > 0) {
    const { error } = await supabase
      .from('quick_note_items')
      .insert(items.map((it, i) => ({ note_id: noteId!, body: it.body, done: it.done, sort_order: i })));
    if (error) return fail(error);
  }

  const shared = await setShares(noteId!, me, before, share_ids, body || items[0]?.body || '');
  if (shared) return shared;

  revalidate(customer_id);
  if (oldCustomer && oldCustomer !== customer_id) revalidate(oldCustomer);
  return { ok: true, data: { id: noteId! } };
}

/** Make a note shared with exactly these people; whoever is new is told. Returns the failure, if any. */
async function setShares(noteId: string, me: string, before: string[], shareIds: string[], heading: string): Promise<{ ok: false; error: string } | null> {
  const supabase = createClient();
  const wanted = [...new Set(shareIds.filter((p) => p !== me))];
  const added = wanted.filter((p) => !before.includes(p));
  const removed = before.filter((p) => !wanted.includes(p));
  if (removed.length) {
    const { error } = await supabase.from('quick_note_shares').delete().eq('note_id', noteId).in('profile_id', removed);
    if (error) return fail(error);
  }
  if (added.length) {
    const { error } = await supabase.from('quick_note_shares').insert(added.map((profile_id) => ({ note_id: noteId, profile_id })));
    if (error) return fail(error);
    const { data: who } = await supabase.from('profiles').select('name, email').eq('id', me).maybeSingle();
    try {
      // In Spanish, like every other server-sent notification.
      await sendToUsers(added, {
        title: `${who?.name || who?.email || 'Alguien'} compartió una nota contigo`,
        body: heading.split('\n')[0].slice(0, 120),
        url: `/space/notes/${noteId}`,
        tag: `note-${noteId}`,
      });
    } catch (err) {
      console.error('note share notice failed', err);
    }
  }
  return null;
}

/* ------------------------- a note as a page ------------------------- */

/** A new, empty page — written in place once it is open. */
export async function createNotePage(): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('quick_notes').insert({ title: '', body: '' }).select('id').single();
  if (error) return fail(error);
  revalidate();
  return { ok: true, data: { id: data.id } };
}

const contentSchema = z.object({
  id: uuid,
  title: z.string().max(200).transform((v) => v.trim()),
  body: z.string().max(4000),
  items: z.array(z.object({ body: z.string().trim().min(1).max(300), done: z.boolean() })).max(100),
});

/**
 * What the page holds — title, text and checklist — saved as it is written.
 * Who it is shared with and its customer are not touched.
 */
export async function saveNoteContent(input: z.input<typeof contentSchema>): Promise<ActionResult> {
  const parsed = contentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { id, title, body, items } = parsed.data;
  const supabase = createClient();
  const { data, error } = await supabase.from('quick_notes').update({ title, body: body.trim() }).eq('id', id).select('customer_id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  const { error: delError } = await supabase.from('quick_note_items').delete().eq('note_id', id);
  if (delError) return fail(delError);
  if (items.length > 0) {
    const { error: addError } = await supabase
      .from('quick_note_items')
      .insert(items.map((it, i) => ({ note_id: id, body: it.body, done: it.done, sort_order: i })));
    if (addError) return fail(addError);
  }
  revalidate(data[0].customer_id);
  return { ok: true, data: undefined };
}

const settingsSchema = z.object({ id: uuid, customer_id: uuid.nullable(), share_ids: z.array(uuid).max(50) });

/** Whose customer file the note is in, and who else sees it. */
export async function saveNoteSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { id, customer_id, share_ids } = parsed.data;
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) return { ok: false, error: 'not_authorized' };
  const { data: old } = await supabase
    .from('quick_notes')
    .select('owner_id, title, body, customer_id, shares:quick_note_shares ( profile_id )')
    .eq('id', id)
    .maybeSingle();
  if (!old || old.owner_id !== me) return { ok: false, error: 'not_authorized' };
  if (old.customer_id !== customer_id) {
    const { error } = await supabase.from('quick_notes').update({ customer_id }).eq('id', id);
    if (error) return fail(error);
  }
  const shared = await setShares(id, me, (old.shares ?? []).map((s: { profile_id: string }) => s.profile_id), share_ids, old.title || old.body);
  if (shared) return shared;
  revalidate(customer_id);
  if (old.customer_id && old.customer_id !== customer_id) revalidate(old.customer_id);
  return { ok: true, data: undefined };
}

/** Tick or untick a checklist line — the owner, or whoever it is shared with. */
export async function tickNoteItem(itemId: string, done: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(itemId).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { data, error } = await supabase.from('quick_note_items').update({ done }).eq('id', itemId).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate();
  return { ok: true, data: undefined };
}

async function ownUpdate(id: string, patch: { pinned?: boolean; archived_at?: string | null }): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { data, error } = await supabase.from('quick_notes').update(patch).eq('id', id).select('customer_id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate(data[0].customer_id);
  return { ok: true, data: undefined };
}

export async function setNotePinned(id: string, pinned: boolean): Promise<ActionResult> {
  return ownUpdate(id, { pinned });
}

/** Done with it: out of the list, still findable and restorable. */
export async function setNoteArchived(id: string, archived: boolean): Promise<ActionResult> {
  return ownUpdate(id, { archived_at: archived ? new Date().toISOString() : null });
}

export async function deleteNote(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { data, error } = await supabase.from('quick_notes').delete().eq('id', id).select('customer_id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate(data[0].customer_id);
  return { ok: true, data: undefined };
}

/** What the note editor offers: people to share with and customers to file it under. */
export async function loadNoteChoices(): Promise<ActionResult<{ people: { id: string; name: string }[]; customers: { id: string; name: string }[] }>> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const [{ data: people }, { data: customers }] = await Promise.all([
    supabase.from('profiles').select('id, name, email').eq('status', 'approved').is('deleted_at', null).order('name'),
    supabase.from('customers').select('id, company_name').eq('is_active', true).order('company_name'),
  ]);
  return {
    ok: true,
    data: {
      people: (people ?? []).filter((p) => p.id !== auth.user?.id).map((p) => ({ id: p.id, name: p.name || p.email })),
      customers: (customers ?? []).map((c) => ({ id: c.id, name: c.company_name })),
    },
  };
}
