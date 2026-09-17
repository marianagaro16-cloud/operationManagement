import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * The notification inbox — the read side.
 *
 * Read with the caller's own session: RLS returns only their own entries, so
 * nothing here filters by user.
 */

export interface InboxEntry {
  id: string;
  title: string;
  body: string;
  url: string | null;
  level: string | null;
  created_at: string;
  read_at: string | null;
}

/** 60 days of notifications is at most a few hundred rows; 200 is plenty. */
const LIMIT = 200;

export async function getInbox(): Promise<InboxEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('notification_inbox')
    .select('id, title, body, url, level, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as InboxEntry[];
}

export async function getUnreadInboxCount(): Promise<number> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from('notification_inbox')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  // A badge is a convenience. Failing to count must never take the page down.
  if (error) return 0;
  return count ?? 0;
}
