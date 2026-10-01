'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './actions';
import { getPersonalTopics } from './reminders';
import { TOPIC_COLORS, type PersonalTopic } from '@/types/reminders';

/*
 * Topics and categories of personal tasks: each person's own. RLS holds it —
 * nobody reads or changes another person's.
 */

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(60);
const color = z.enum(TOPIC_COLORS).nullable();

function fail(error: { message: string; code?: string }): { ok: false; error: string } {
  if (error.code === '23505' || error.message.includes('_name_key')) return { ok: false, error: 'topic_exists' };
  if (error.message.includes('row-level security') || error.message.includes('topic_not_found')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: error.message };
}

function revalidate() {
  revalidatePath('/reminders/tasks');
  revalidatePath('/reminders/tasks/topics');
}

/** For the task form, wherever it opens. */
export async function loadPersonalTopics(): Promise<ActionResult<PersonalTopic[]>> {
  return { ok: true, data: await getPersonalTopics() };
}

export async function createTopic(input: { name: string; color?: string | null }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ name, color: color.optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'name_required' };
  const supabase = createClient();
  const { data: last } = await supabase.from('personal_task_topics').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase
    .from('personal_task_topics')
    .insert({ name: parsed.data.name, color: parsed.data.color ?? null, sort_order: (last?.sort_order ?? 0) + 10 })
    .select('id')
    .single();
  if (error) return fail(error);
  revalidate();
  return { ok: true, data: { id: data.id } };
}

export async function createCategory(topicId: string, input: { name: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ topicId: uuid, name }).safeParse({ topicId, name: input.name });
  if (!parsed.success) return { ok: false, error: 'name_required' };
  const supabase = createClient();
  const { data: last } = await supabase
    .from('personal_task_categories')
    .select('sort_order')
    .eq('topic_id', topicId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from('personal_task_categories')
    .insert({ topic_id: topicId, name: parsed.data.name, sort_order: (last?.sort_order ?? 0) + 10 })
    .select('id')
    .single();
  if (error) return fail(error);
  revalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateTopic(id: string, input: { name: string; color: string | null }): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, name, color }).safeParse({ id, ...input });
  if (!parsed.success) return { ok: false, error: 'name_required' };
  const supabase = createClient();
  const { data, error } = await supabase
    .from('personal_task_topics')
    .update({ name: parsed.data.name, color: parsed.data.color })
    .eq('id', id)
    .select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate();
  return { ok: true, data: undefined };
}

export async function renameCategory(id: string, newName: string): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, name }).safeParse({ id, name: newName });
  if (!parsed.success) return { ok: false, error: 'name_required' };
  const supabase = createClient();
  const { data, error } = await supabase.from('personal_task_categories').update({ name: parsed.data.name }).eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate();
  return { ok: true, data: undefined };
}

/** Archived: out of the pickers; tasks filed under it keep showing it. */
export async function setTopicArchived(kind: 'topic' | 'category', id: string, archived: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const archived_at = archived ? new Date().toISOString() : null;
  const { data, error } =
    kind === 'topic'
      ? await supabase.from('personal_task_topics').update({ archived_at }).eq('id', id).select('id')
      : await supabase.from('personal_task_categories').update({ archived_at }).eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate();
  return { ok: true, data: undefined };
}

/** Move one up or down among its siblings. */
export async function moveTopic(kind: 'topic' | 'category', id: string, direction: -1 | 1): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  let siblings: { id: string; sort_order: number; name: string }[] = [];
  if (kind === 'topic') {
    const { data } = await supabase.from('personal_task_topics').select('id, sort_order, name').is('archived_at', null);
    siblings = data ?? [];
  } else {
    const { data: me } = await supabase.from('personal_task_categories').select('topic_id').eq('id', id).maybeSingle();
    if (!me) return { ok: false, error: 'not_authorized' };
    const { data } = await supabase
      .from('personal_task_categories')
      .select('id, sort_order, name')
      .eq('topic_id', me.topic_id)
      .is('archived_at', null);
    siblings = data ?? [];
  }
  siblings.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const i = siblings.findIndex((s) => s.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= siblings.length) return { ok: true, data: undefined };
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  // Renumbered in steps of ten, so ties from older rows cannot keep two in place.
  for (const [k, s] of siblings.entries()) {
    const { error } =
      kind === 'topic'
        ? await supabase.from('personal_task_topics').update({ sort_order: (k + 1) * 10 }).eq('id', s.id)
        : await supabase.from('personal_task_categories').update({ sort_order: (k + 1) * 10 }).eq('id', s.id);
    if (error) return fail(error);
  }
  revalidate();
  return { ok: true, data: undefined };
}
