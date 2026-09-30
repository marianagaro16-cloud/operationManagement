'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { sendToUsers } from './push';
import { buildSummary } from './sales-summary';
import type { ActionResult } from './actions';

/*
 * Highlights and the summary. People in sales star notes, save a summary of
 * a period and share it (RLS: is_sales); whoever it is shared with reads the
 * snapshot.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: error.message };
}

/** A note as a highlight, or not. */
export async function setNoteStar(target: 'customer' | 'prospect', noteId: string, starred: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(noteId).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const table = target === 'customer' ? 'customer_notes' : 'prospect_notes';
  const { data, error } = await supabase.from(table).update({ starred }).eq('id', noteId).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidatePath('/sales', 'layout');
  return { ok: true, data: undefined };
}

/** Save the summary of a period as it is now, to share it. */
export async function createSummary(from: string, to: string, title: string): Promise<ActionResult<{ id: string }>> {
  if (!DATE.safeParse(from).success || !DATE.safeParse(to).success || to < from) return { ok: false, error: 'invalid_period' };
  const name = title.trim().slice(0, 200);
  if (!name) return { ok: false, error: 'title_required' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const content = await buildSummary(from, to);
  const { data, error } = await supabase
    .from('sales_summaries')
    .insert({ title: name, period_from: from, period_to: to, content, created_by: user?.id ?? null })
    .select('id')
    .single();
  if (error) return fail(error);
  revalidatePath('/sales');
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/** Send it to people: they can open it, and are told. */
export async function sendSummary(id: string, people: string[]): Promise<ActionResult<{ sent: number }>> {
  const parsed = z.array(uuid).min(1).max(60).safeParse([...new Set(people)]);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, error: 'invalid_recipients' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: summary } = await supabase.from('sales_summaries').select('title').eq('id', id).maybeSingle();
  if (!summary) return { ok: false, error: 'not_authorized' };
  const { error } = await supabase
    .from('sales_summary_recipients')
    .upsert(parsed.data.map((profile_id) => ({ summary_id: id, profile_id, sent_by: user?.id ?? null })), { onConflict: 'summary_id,profile_id', ignoreDuplicates: true });
  if (error) return fail(error);
  const others = parsed.data.filter((p) => p !== user?.id);
  if (others.length) {
    try {
      // In Spanish, like every other server-sent notification.
      await sendToUsers(others, { title: 'Resumen de ventas', body: summary.title, url: `/summaries/${id}`, tag: `summary-${id}` });
    } catch (err) {
      console.error('summary notice failed', err);
    }
  }
  return { ok: true, data: { sent: others.length } };
}

/** Attach it to a meeting: its organiser and invitees can open it, and are told. */
export async function attachSummary(id: string, meetingId: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(meetingId).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('meeting_summaries')
    .upsert({ meeting_id: meetingId, summary_id: id, attached_by: user?.id ?? null }, { onConflict: 'meeting_id,summary_id', ignoreDuplicates: true });
  if (error) return fail(error);
  const [{ data: meeting }, { data: summary }] = await Promise.all([
    supabase.from('meetings').select('title, organizer_id, invitees:meeting_invitees ( profile_id )').eq('id', meetingId).maybeSingle(),
    supabase.from('sales_summaries').select('title').eq('id', id).maybeSingle(),
  ]);
  if (meeting && summary) {
    const m = meeting as unknown as { title: string; organizer_id: string; invitees: { profile_id: string }[] };
    const people = [m.organizer_id, ...m.invitees.map((i) => i.profile_id)].filter((p) => p !== user?.id);
    try {
      await sendToUsers([...new Set(people)], { title: `Resumen para «${m.title}»`, body: summary.title, url: `/summaries/${id}`, tag: `summary-${id}-${meetingId}` });
    } catch (err) {
      console.error('summary notice failed', err);
    }
  }
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, data: undefined };
}
