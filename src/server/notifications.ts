import 'server-only';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { Profile } from '@/types/database';

/**
 * Direct notifications — the read side.
 *
 * Who may be sent one, and which of them a push would actually reach.
 *
 * That second question is the whole reason this file exists. Delivery is
 * push-only: no row is written, so a message to somebody who never enabled
 * notifications is not delayed or queued, it is simply gone. The sender has
 * to be able to see that BEFORE sending, not infer it from a delivery count
 * afterwards.
 */

export interface NotifiableUser {
  id: string;
  name: string | null;
  email: string;
  /**
   * Has at least one live push subscription.
   *
   * A boolean and never the endpoints themselves. `push_subscriptions` is
   * readable only by its owner — an endpoint is a capability URL for
   * delivering to somebody's device, not team data — so this is derived with
   * the service role and deliberately collapsed to yes/no before it leaves
   * the server.
   */
  reachable: boolean;
}

/**
 * The people a direct notification may be addressed to.
 *
 * Only the 'user' role, and only approved accounts. The rule is repeated in
 * `sendDirectNotification`, which is the one that matters — this list shapes
 * the picker, the action is what refuses.
 */
export async function getNotifiableUsers(): Promise<NotifiableUser[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email')
    .eq('role', 'user')
    .eq('status', 'approved')
    .order('name', { nullsFirst: false });

  if (error) throw new Error(error.message);

  const users = (data ?? []) as Pick<Profile, 'id' | 'name' | 'email'>[];
  if (users.length === 0) return [];

  const reachable = await reachableUserIds(users.map((u) => u.id));

  return users.map((u) => ({ ...u, reachable: reachable.has(u.id) }));
}

/**
 * Which of these users have a device registered. Service role: see above.
 *
 * Shared with `sendDirectNotification`, which reports the same fact after the
 * send. Two implementations of "can we reach this person" would eventually
 * disagree, and the screen would then promise a delivery the send did not make.
 */
export async function reachableUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const admin = createAdminClient();
  const { data } = await admin
    .from('push_subscriptions')
    .select('user_id')
    .in('user_id', userIds);

  return new Set((data ?? []).map((r) => (r as { user_id: string }).user_id));
}
