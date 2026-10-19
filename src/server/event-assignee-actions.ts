'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './actions';

/* An assignee's own part of an event: what they bring, ticked; their task, done. */

const uuid = z.string().uuid();

function done(eventId?: string): ActionResult {
  if (eventId) revalidatePath(`/events/${eventId}`);
  revalidatePath('/sales');
  revalidatePath('/agenda');
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

export async function tickMyMaterial(id: string, eventId: string, field: 'packed' | 'came_back', value: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || (field !== 'packed' && field !== 'came_back')) return { ok: false, error: 'invalid_material' };
  const supabase = createClient();
  const { error } = await supabase.rpc('my_event_material_tick', { p_id: id, p_field: field, p_value: value });
  if (error) return { ok: false, error: error.message.includes('not_authorized') ? 'not_authorized' : error.message };
  return done(eventId);
}

export async function completeMyEventTask(id: string, eventId?: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { error } = await supabase.rpc('my_event_task_done', { p_id: id });
  if (error) return { ok: false, error: error.message.includes('not_authorized') ? 'not_authorized' : error.message };
  return done(eventId);
}
