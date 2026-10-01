'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MARKETING_ALLOWED_MIME, MARKETING_BUCKET, MARKETING_MAX_BYTES, POST_CHANNELS, POST_STATUSES } from '@/lib/marketing';
import type { ActionResult } from './actions';

/*
 * Content plan writes. Who may is the database's (can_edit_marketing):
 * Marketing, Admin and Owners.
 */

const uuid = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0).max(1_000_000_000).nullable();

function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: error.message };
}

function revalidate(id?: string, eventId?: string | null) {
  revalidatePath('/marketing');
  if (id) revalidatePath(`/marketing/${id}`);
  if (eventId) revalidatePath(`/events/${eventId}`);
}

const postSchema = z.object({
  title: z.string().trim().min(1, { message: 'title_required' }).max(200),
  brand_id: uuid.nullable(),
  status: z.enum(POST_STATUSES),
  planned_on: DATE.nullable(),
  channels: z.array(z.enum(POST_CHANNELS)).max(POST_CHANNELS.length),
  caption: z.string().max(5000).nullable().transform((v) => v?.trim() || null),
  event_id: uuid.nullable(),
  product_ids: z.array(uuid).max(100),
  reach: count.optional(),
  likes: count.optional(),
  comments: count.optional(),
});

export type PostInput = z.input<typeof postSchema>;

export async function savePost(input: PostInput, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const { product_ids, ...fields } = parsed.data;
  const supabase = createClient();

  let postId = id;
  if (id) {
    const { data, error } = await supabase.from('marketing_posts').update(fields).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return { ok: false, error: 'not_authorized' };
    const { error: delError } = await supabase.from('marketing_post_products').delete().eq('post_id', id);
    if (delError) return fail(delError);
  } else {
    const { data, error } = await supabase.from('marketing_posts').insert(fields).select('id').single();
    if (error) return fail(error);
    postId = data.id;
  }
  const ids = [...new Set(product_ids)];
  if (ids.length) {
    const { error } = await supabase.from('marketing_post_products').insert(ids.map((product_id) => ({ post_id: postId!, product_id })));
    if (error) return fail(error);
  }
  revalidate(postId, fields.event_id);
  return { ok: true, data: { id: postId! } };
}

/** Move along: idea → in progress → published (or back). */
export async function setPostStatus(id: string, status: (typeof POST_STATUSES)[number]): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || !POST_STATUSES.includes(status)) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { data, error } = await supabase.from('marketing_posts').update({ status }).eq('id', id).select('event_id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate(id, data[0].event_id);
  return { ok: true, data: undefined };
}

export async function deletePost(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { data: files } = await supabase.from('marketing_post_files').select('storage_path').eq('post_id', id);
  const { data, error } = await supabase.from('marketing_posts').delete().eq('id', id).select('event_id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  if (files?.length) await supabase.storage.from(MARKETING_BUCKET).remove(files.map((f) => f.storage_path));
  revalidate(undefined, data[0].event_id);
  return { ok: true, data: undefined };
}

const fileSchema = z.object({
  post_id: uuid,
  storage_path: z.string().min(1).max(300),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().refine((m) => MARKETING_ALLOWED_MIME.includes(m), { message: 'type_not_allowed' }),
  size_bytes: z.number().int().positive().max(MARKETING_MAX_BYTES),
});

/** Records a file the browser already uploaded; the path must sit in the post's folder. */
export async function recordPostFile(input: z.input<typeof fileSchema>): Promise<ActionResult> {
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_file' };
  if (!parsed.data.storage_path.startsWith(`${parsed.data.post_id}/`)) return { ok: false, error: 'invalid_file' };
  const supabase = createClient();
  const { error } = await supabase.from('marketing_post_files').insert(parsed.data);
  if (error) {
    await supabase.storage.from(MARKETING_BUCKET).remove([parsed.data.storage_path]);
    return fail(error);
  }
  revalidate(parsed.data.post_id);
  return { ok: true, data: undefined };
}

export async function removePostFile(id: string, postId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('marketing_post_files').delete().eq('id', id).select('storage_path');
  if (error) return fail(error);
  const path = data?.[0]?.storage_path;
  if (path) await supabase.storage.from(MARKETING_BUCKET).remove([path]);
  revalidate(postId);
  return { ok: true, data: undefined };
}
