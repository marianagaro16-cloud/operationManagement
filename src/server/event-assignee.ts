import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { MyEvent, MyEventWork } from '@/types/events';

/*
 * What someone was given on an event — shifts, material to bring, tasks —
 * read through my_event_work() and my_event(), which return the caller's
 * own part and nothing else of the event (decided 2026-10-19).
 */

const NONE: MyEventWork = { shifts: [], materials: [], tasks: [] };

export async function getMyEventWork(from: string, to: string): Promise<MyEventWork> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('my_event_work', { p_from: from, p_to: to });
  if (error || !data) return NONE;
  return data as unknown as MyEventWork;
}

/** Null when the viewer has nothing on that event. */
export async function getMyEvent(id: string): Promise<MyEvent | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('my_event', { p_event_id: id });
  if (error || !data) return null;
  const event = data as unknown as Omit<MyEvent, 'review'>;
  // Their own view of it, when they worked a shift: RLS returns only their own row.
  let review: MyEvent['review'] = null;
  if (event.shifts.length > 0) {
    const { data: mine } = await supabase
      .from('event_staff_reviews')
      .select('rating, went_well, to_improve')
      .eq('event_id', id)
      .eq('profile_id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .maybeSingle();
    review = mine ?? null;
  }
  return { ...event, review };
}

/** Done events the viewer worked a shift on and has not given their view of yet. */
export async function getMyEventReviewsDue(): Promise<{ event_id: string; name: string; end_date: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('my_event_reviews_due');
  if (error) return [];
  return data ?? [];
}
