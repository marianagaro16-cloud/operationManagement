import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { PresenceRow } from '@/domain/presence';

/**
 * Who is using the app — the read side.
 *
 * Read with the caller's own session: RLS on `user_presence` lets only a
 * holder of `users.manage` see a row, so a non-admin gets an empty list rather
 * than anybody's whereabouts.
 */

export async function getPresence(): Promise<PresenceRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_presence')
    .select('user_id, last_seen_at, started_at, path');
  if (error) throw new Error(error.message);
  return (data ?? []) as PresenceRow[];
}
