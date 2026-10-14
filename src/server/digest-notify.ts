import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { sendToUser } from './push';

/*
 * The owners' daily summary (decided 2026-10-14).
 *
 * What reaches an owner because of their role is filed in their inbox already
 * read (push.ts, `digest`). Once a day, from SUMMARY_HOUR, each owner with
 * something filed gets one notice that lists it. Rows are claimed by marking
 * them before sending, so overlapping runs never list a notice twice.
 * Written in Spanish, like every other server-sent notification.
 */

const SUMMARY_HOUR = 17;
const LISTED = 8;

export async function runOwnerDigest(now = new Date()): Promise<{ sent: number }> {
  if (DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).hour < SUMMARY_HOUR) return { sent: 0 };

  const admin = createAdminClient();
  const { data: pending, error } = await admin
    .from('notification_inbox')
    .select('user_id')
    .eq('in_digest', true)
    .is('digested_at', null);
  if (error) throw new Error(`digest: ${error.message}`);

  const today = businessToday(now);
  let sent = 0;
  for (const userId of new Set(((pending ?? []) as { user_id: string }[]).map((r) => r.user_id))) {
    const { data: claimed, error: claimError } = await admin
      .from('notification_inbox')
      .update({ digested_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('in_digest', true)
      .is('digested_at', null)
      .select('title, body, created_at');
    if (claimError || !claimed?.length) continue;

    const items = (claimed as { title: string; body: string; created_at: string }[])
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const lines = items.slice(0, LISTED).map((i) => `• ${i.title}${i.body ? `: ${i.body}` : ''}`.slice(0, 120));
    if (items.length > LISTED) lines.push(`… y ${items.length - LISTED} más en la bandeja`);

    // Filed in the inbox whether or not a device is reached, so nothing is lost.
    await sendToUser(userId, {
      title: items.length === 1 ? 'Resumen del día: 1 aviso' : `Resumen del día: ${items.length} avisos`,
      body: lines.join('\n'),
      url: '/space/inbox',
      tag: `digest-${today}`,
    });
    sent++;
  }
  return { sent };
}
