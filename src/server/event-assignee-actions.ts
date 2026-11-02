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

/** Their own short view of an event they worked a shift on, once it is done. */
export async function saveMyEventReview(
  eventId: string,
  input: { rating: number | null; went_well: string; to_improve: string },
): Promise<ActionResult> {
  const rating = input.rating;
  if (!uuid.safeParse(eventId).success || (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5))) {
    return { ok: false, error: 'invalid_results' };
  }
  const wentWell = input.went_well.trim().slice(0, 2000);
  const toImprove = input.to_improve.trim().slice(0, 2000);
  if (rating === null && !wentWell && !toImprove) return { ok: false, error: 'review_empty' };
  const supabase = createClient();
  const { error } = await supabase.rpc('event_staff_review_save', {
    p_event_id: eventId,
    p_rating: rating as number,
    p_went_well: wentWell,
    p_to_improve: toImprove,
  });
  if (error) {
    const known = ['not_authorized', 'event_not_done', 'invalid_results'].find((c) => error.message.includes(c));
    return { ok: false, error: known ?? error.message };
  }
  revalidatePath('/events');
  return done(eventId);
}
