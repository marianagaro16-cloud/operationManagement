import { DateTime } from 'luxon';
import { BUSINESS_TZ } from '@/lib/datetime';
import type { Frequency } from '@/domain/recurrence/types';
import { sendToUser } from './push';

/*
 * Telling someone an activity is now theirs.
 *
 * Sent when a person is chosen — as an activity's regular person, or for one
 * day — and never for each day the activity then comes round: that would be
 * a notification every morning for work they already know is theirs.
 * Written in Spanish, like every other server-sent notification.
 */

const FREQUENCY_ES: Record<Frequency, string> = {
  daily: 'diaria',
  weekly: 'semanal',
  biweekly: 'quincenal',
  monthly: 'mensual',
  semiannual: 'semestral',
};

/** Never fails the save that caused it: a missed push is not a lost assignment. */
async function send(userId: string, body: string) {
  try {
    await sendToUser(userId, { title: 'Actividad asignada', body, url: '/dashboard', tag: 'activity-assigned' });
  } catch (err) {
    console.error('activity-notify: send failed', err);
  }
}

export async function notifyActivityAssigned(userId: string, title: string, frequency: Frequency) {
  await send(userId, `${title} (${FREQUENCY_ES[frequency] ?? frequency}) — a partir de ahora la haces tú.`);
}

export async function notifyActivityDayAssigned(userId: string, title: string, date: string) {
  const day = DateTime.fromISO(date, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.');
  await send(userId, `${title} — el ${day} la haces tú.`);
}
