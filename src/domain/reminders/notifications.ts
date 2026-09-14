import { DateTime } from 'luxon';
import { BUSINESS_TZ } from '@/lib/datetime';

/**
 * Which reminder alerts are due to go out.
 *
 * Pure, like selectNotifications() for orders: the scheduler supplies the
 * open reminders near their moment and the alerts already sent, and gets back
 * exactly what to send now. Running it twice, or every five minutes, never
 * sends the same alert twice — the ledger rows are the memory.
 *
 * THE POLICY
 *
 *   before   once, `notify_before_minutes` ahead of the moment, if asked for
 *   due      once, at the moment
 *   overdue  at most three more: 1 hour, 4 hours and 24 hours after it
 *
 * After the third overdue alert the reminder goes quiet but stays in the
 * Overdue list, highlighted, until somebody completes, snoozes or cancels it.
 * It is never removed for being ignored.
 *
 * Overdue repeats are held between 22:00 and 07:00: a reminder nobody acted
 * on at 18:00 should not wake anyone at 22:00 and again at 02:00. The due
 * alert itself is never held — somebody chose that time.
 *
 * A snooze or a completed occurrence moves the moment, and the ledger is
 * keyed on the moment, so the new one gets the full sequence again.
 */

export const OVERDUE_STEPS_MINUTES = [60, 240, 1440] as const;

/** A due alert more than this late is not sent as "due" — it is overdue by then. */
export const DUE_GRACE_MINUTES = 60;

export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 7;

export interface NotifiableReminder {
  id: string;
  title: string;
  /** coalesce(snoozed_until, due_at) — the moment alerts belong to. */
  next_at: string;
  timezone: string;
  notify_before_minutes: number | null;
  participant_ids: string[];
}

export interface SentAlert {
  reminder_id: string;
  kind: 'before' | 'due' | 'overdue';
  step: number;
  slot_at: string;
}

export interface PendingAlert {
  reminderId: string;
  kind: 'before' | 'due' | 'overdue';
  step: number;
  slotAt: string;
  recipients: string[];
  title: string;
  /** Wall-clock time of the moment in the reminder's zone, e.g. "10:00". */
  time: string;
}

/**
 * A timestamp in any form Postgres or PostgREST hands back.
 *
 * `2026-09-16T08:00:00+00:00`, `2026-09-16T08:00:00.000Z` and the text form
 * `2026-09-16 08:00:00+00` are the same instant. Luxon's ISO parser refuses
 * the last one, and a ledger row it could not read would look unsent — an
 * alert repeated every five minutes.
 */
export function momentOf(value: string): DateTime {
  const iso = DateTime.fromISO(value);
  if (iso.isValid) return iso;
  const normalised = value.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  return DateTime.fromISO(normalised);
}

const sameMoment = (a: string, b: string) => momentOf(a).toMillis() === momentOf(b).toMillis();

export function isQuietHour(nowIso: string, zone: string = BUSINESS_TZ): boolean {
  const hour = DateTime.fromISO(nowIso).setZone(zone).hour;
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

export function selectReminderAlerts(
  reminders: NotifiableReminder[],
  sent: SentAlert[],
  nowIso: string,
): PendingAlert[] {
  const now = DateTime.fromISO(nowIso);
  const out: PendingAlert[] = [];

  for (const r of reminders) {
    if (r.participant_ids.length === 0) continue;
    const slot = momentOf(r.next_at);
    if (!slot.isValid) continue;

    const forSlot = sent.filter((s) => s.reminder_id === r.id && sameMoment(s.slot_at, r.next_at));
    const has = (kind: SentAlert['kind'], step = 0) =>
      forSlot.some((s) => s.kind === kind && s.step === step);

    const base = {
      reminderId: r.id,
      slotAt: r.next_at,
      recipients: r.participant_ids,
      title: r.title,
      time: slot.setZone(r.timezone).toFormat('HH:mm'),
    };

    const minutesPast = now.diff(slot, 'minutes').minutes;

    if (minutesPast < 0) {
      // Before the moment: only the early warning, if one was asked for.
      if (r.notify_before_minutes && -minutesPast <= r.notify_before_minutes && !has('before')) {
        out.push({ ...base, kind: 'before', step: 0 });
      }
      continue;
    }

    if (minutesPast < DUE_GRACE_MINUTES) {
      if (!has('due')) out.push({ ...base, kind: 'due', step: 0 });
      continue;
    }

    // Overdue. Send only the LATEST step reached and not yet sent, so a
    // scheduler that was down for a day sends one alert, not three at once.
    const reached = OVERDUE_STEPS_MINUTES.filter((m) => minutesPast >= m).length;
    if (reached === 0) continue;
    const highestSent = Math.max(0, ...forSlot.filter((s) => s.kind === 'overdue').map((s) => s.step));
    if (reached <= highestSent) continue;
    if (isQuietHour(nowIso, r.timezone)) continue;

    out.push({ ...base, kind: 'overdue', step: reached });
  }

  return out;
}

/**
 * The window of reminders the scheduler has to look at: anything whose moment
 * is within the longest early warning ahead, or within the last overdue step
 * behind (plus a margin for quiet hours holding it back).
 */
export function notificationWindow(nowIso: string): { from: string; to: string } {
  const now = DateTime.fromISO(nowIso);
  const lastStep = OVERDUE_STEPS_MINUTES[OVERDUE_STEPS_MINUTES.length - 1];
  return {
    from: now.minus({ minutes: lastStep + 9 * 60 }).toUTC().toISO()!,
    to: now.plus({ minutes: 1440 }).toUTC().toISO()!,
  };
}

/**
 * Push text.
 *
 * Spanish, as the delivery notifications are: the scheduler has no request
 * and therefore no language cookie, and Spanish is the app's default locale.
 * The title is the reminder itself, which is in whatever language its author
 * wrote it — the part people actually read.
 */
export function alertText(alert: PendingAlert): { title: string; body: string } {
  switch (alert.kind) {
    case 'before':  return { title: alert.title, body: `Recordatorio a las ${alert.time}` };
    case 'due':     return { title: alert.title, body: `Recordatorio · ${alert.time}` };
    case 'overdue': return { title: alert.title, body: `Recordatorio vencido · ${alert.time}` };
  }
}
