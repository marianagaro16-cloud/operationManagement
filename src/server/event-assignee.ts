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
  return data as unknown as MyEvent;
}
