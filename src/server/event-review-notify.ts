import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, addDays, businessToday } from '@/lib/datetime';
import { RESULT_COLUMNS, REVIEW_REMIND_DAYS, hasResults } from '@/lib/events';
import { sendToUser } from './push';

const NOTICE_AT = '09:00';
/** Older than this, an empty review is left to Inicio: no push for events long past. */
const PUSH_WITHIN_DAYS = 14;

/**
 * The review still empty three days after the event (decided 2026-11-02):
 * its responsible person is told once, in the morning. Inicio keeps showing
 * it until the review is filled.
 */
export async function runEventReviewNotices(now = new Date()): Promise<{ sent: number }> {
  if (DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).toFormat('HH:mm') < NOTICE_AT) return { sent: 0 };
  const today = businessToday(now);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('events')
    .select(`id, name, owner_id, stage, end_date, ${RESULT_COLUMNS.join(', ')}`)
    .in('stage', ['confirmed', 'done'])
    .not('owner_id', 'is', null)
    .lte('end_date', addDays(today, -REVIEW_REMIND_DAYS))
    .gte('end_date', addDays(today, -PUSH_WITHIN_DAYS));
  if (error) throw new Error(`event review notices: ${error.message}`);

  let sent = 0;
  for (const e of (data ?? []) as unknown as ({ id: string; name: string; owner_id: string; stage: string } & Record<string, unknown>)[]) {
    if (hasResults(e)) continue;
    const { data: claimed } = await admin
      .from('event_review_notices')
      .upsert({ event_id: e.id }, { onConflict: 'event_id', ignoreDuplicates: true })
      .select('event_id');
    if (!claimed?.length) continue;
    try {
      // In Spanish, like every other server-sent notification.
      await sendToUser(e.owner_id, {
        title: `${e.name}: ¿cómo fue?`,
        body: e.stage === 'confirmed'
          ? 'El evento ya pasó. Márcalo como realizado y cuenta cómo fue.'
          : 'Todavía falta contar cómo fue el evento.',
        url: `/events/${e.id}`,
        tag: `event-review-due-${e.id}`,
      });
      sent++;
    } catch (err) {
      console.error('event review notices: send failed', err);
    }
  }
  return { sent };
}
