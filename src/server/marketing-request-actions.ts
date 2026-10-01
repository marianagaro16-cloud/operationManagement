'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MARKETING_ALLOWED_MIME, MARKETING_MAX_BYTES, REQUESTS_BUCKET, REQUEST_STATUSES } from '@/lib/marketing';
import { sendToMarketing, sendToUser } from './push';
import type { ActionResult } from './actions';

/*
 * Requests to Marketing. RLS and guard_marketing_request() hold who may do
 * what; these shape the input and tell the other side.
 */

const uuid = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security') || error.message.includes('not_authorized')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: error.message };
}

function revalidate(id?: string) {
  revalidatePath('/marketing/requests');
  if (id) revalidatePath(`/marketing/requests/${id}`);
  revalidatePath('/', 'layout');
}

async function me() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('id, name, email, team, role').eq('id', user.id).maybeSingle();
  return data;
}

/** Tells, never fails the action. In Spanish, like every server-sent notification. */
async function tell(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error('marketing request notice failed', err);
  }
}

const requestSchema = z.object({
  title: z.string().trim().min(1, { message: 'title_required' }).max(200),
  description: z.string().max(5000).nullable().transform((v) => v?.trim() || null),
  brand_id: uuid.nullable(),
  due_on: DATE.nullable(),
});

export async function saveRequest(input: z.input<typeof requestSchema>, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const supabase = createClient();
  const who = await me();
  if (!who) return { ok: false, error: 'not_authorized' };
  if (id) {
    const { data, error } = await supabase.from('marketing_requests').update(parsed.data).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return { ok: false, error: 'not_authorized' };
    revalidate(id);
    return { ok: true, data: { id } };
  }
  const { data, error } = await supabase.from('marketing_requests').insert({ ...parsed.data, requested_by: who.id }).select('id').single();
  if (error) return fail(error);
  await tell(() =>
    sendToMarketing(
      {
        title: `Nueva solicitud de ${who.name || who.email}`,
        body: parsed.data.title,
        url: `/marketing/requests/${data.id}`,
        tag: `mkt-request-${data.id}`,
      },
      who.id,
    ),
  );
  revalidate(data.id);
  return { ok: true, data: { id: data.id } };
}

/** Marketing moves it along; whoever asked may only cancel it while new. */
export async function setRequestStatus(id: string, status: (typeof REQUEST_STATUSES)[number]): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || !REQUEST_STATUSES.includes(status)) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const who = await me();
  const { data, error } = await supabase.from('marketing_requests').update({ status }).eq('id', id).select('title, requested_by');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  const { title, requested_by } = data[0];
  if (requested_by !== who?.id && (status === 'done' || status === 'in_progress')) {
    await tell(() =>
      sendToUser(requested_by, {
        title: status === 'done' ? 'Tu solicitud a Marketing está lista' : 'Marketing está trabajando en tu solicitud',
        body: title,
        url: `/marketing/requests/${id}`,
        tag: `mkt-request-${id}`,
      }),
    );
  }
  revalidate(id);
  return { ok: true, data: undefined };
}

/** A comment; the other side is told. */
export async function addRequestComment(id: string, body: string): Promise<ActionResult> {
  const text = body.trim();
  if (!uuid.safeParse(id).success || !text || text.length > 4000) return { ok: false, error: 'body_required' };
  const supabase = createClient();
  const who = await me();
  if (!who) return { ok: false, error: 'not_authorized' };
  const { error } = await supabase.from('marketing_request_comments').insert({ request_id: id, body: text, author_id: who.id });
  if (error) return fail(error);
  const { data: req } = await supabase.from('marketing_requests').select('title, requested_by').eq('id', id).maybeSingle();
  if (req) {
    const payload = { title: `${who.name || who.email} comentó «${req.title}»`, body: text.slice(0, 140), url: `/marketing/requests/${id}`, tag: `mkt-request-${id}` };
    await tell(() => (req.requested_by === who.id ? sendToMarketing(payload, who.id) : sendToUser(req.requested_by, payload)));
  }
  revalidate(id);
  return { ok: true, data: undefined };
}

/**
 * Plan it: a post of the content plan, from the request's title, text, brand
 * and due day, linked back to the request.
 */
export async function planRequestAsPost(id: string): Promise<ActionResult<{ postId: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { data: req } = await supabase.from('marketing_requests').select('title, description, brand_id, due_on, post_id').eq('id', id).maybeSingle();
  if (!req) return { ok: false, error: 'not_authorized' };
  if (req.post_id) return { ok: true, data: { postId: req.post_id } };
  const { data: post, error } = await supabase
    .from('marketing_posts')
    .insert({ title: req.title, caption: req.description, brand_id: req.brand_id, planned_on: req.due_on, status: 'in_progress' })
    .select('id')
    .single();
  if (error) return fail(error);
  const { error: linkError } = await supabase.from('marketing_requests').update({ post_id: post.id, status: 'in_progress' }).eq('id', id);
  if (linkError) return fail(linkError);
  revalidate(id);
  revalidatePath('/marketing');
  return { ok: true, data: { postId: post.id } };
}

const fileSchema = z.object({
  request_id: uuid,
  storage_path: z.string().min(1).max(300),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().refine((m) => MARKETING_ALLOWED_MIME.includes(m), { message: 'type_not_allowed' }),
  size_bytes: z.number().int().positive().max(MARKETING_MAX_BYTES),
});

export async function recordRequestFile(input: z.input<typeof fileSchema>): Promise<ActionResult> {
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_file' };
  if (!parsed.data.storage_path.startsWith(`${parsed.data.request_id}/`)) return { ok: false, error: 'invalid_file' };
  const supabase = createClient();
  const { error } = await supabase.from('marketing_request_files').insert(parsed.data);
  if (error) {
    await supabase.storage.from(REQUESTS_BUCKET).remove([parsed.data.storage_path]);
    return fail(error);
  }
  revalidate(parsed.data.request_id);
  return { ok: true, data: undefined };
}

export async function removeRequestFile(fileId: string, requestId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('marketing_request_files').delete().eq('id', fileId).select('storage_path');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  await supabase.storage.from(REQUESTS_BUCKET).remove([data[0].storage_path]);
  revalidate(requestId);
  return { ok: true, data: undefined };
}
