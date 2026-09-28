import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { upcomingCelebrations, type Celebration } from '@/domain/hr/celebrations';
import { sendToUser } from './push';

/*
 * Birthdays and work anniversaries.
 *
 * The dashboard card reads as the viewer, so RLS decides whose appear — the
 * files they may open. The notifier runs as the system and asks
 * hr_celebration_recipients() who may be told about each person.
 */

/** Notices go out from this hour, Europe/Zurich. */
const NOTICE_HOUR = 9;
/** The heads-up, this many days before. */
const DAYS_BEFORE = 3;
/** How far ahead the dashboard card looks. */
export const CARD_DAYS = 7;

const WORKER_COLUMNS = 'id, name, birth_date, start_date';

/** What falls in the coming week among the files the viewer may open. Current staff only. */
export async function getUpcomingCelebrations(): Promise<Celebration[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_workers')
    .select(WORKER_COLUMNS)
    .eq('is_active', true)
    .or('birth_date.not.is.null,start_date.not.is.null');
  if (error) return [];
  return upcomingCelebrations(data ?? [], businessToday(), CARD_DAYS);
}

const day = (date: string) => DateTime.fromISO(date, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.');

/** Written in Spanish, like every other server-sent notification. */
function message(c: Celebration): { title: string; body: string } {
  const years = c.years === 1 ? '1 año' : `${c.years} años`;
  if (c.kind === 'birthday') {
    return c.daysAway === 0
      ? { title: 'Cumpleaños hoy', body: `Hoy es el cumpleaños de ${c.name} (${years}).` }
      : { title: 'Cumpleaños', body: `${c.name} cumple ${years} el ${day(c.date)}.` };
  }
  return c.daysAway === 0
    ? { title: 'Aniversario de trabajo hoy', body: `Hoy ${c.name} cumple ${years} en la empresa.` }
    : { title: 'Aniversario de trabajo', body: `El ${day(c.date)} ${c.name} cumple ${years} en la empresa.` };
}

/**
 * Tell whoever may see the file, 3 days before and on the day. Called every
 * few minutes by the reminders cron; each notice is claimed before it is
 * sent, so overlapping runs never send one twice.
 */
export async function runCelebrationNotices(now = new Date()): Promise<{ sent: number }> {
  if (DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).hour < NOTICE_HOUR) return { sent: 0 };

  const admin = createAdminClient();
  const { data: workers, error } = await admin
    .from('hr_workers')
    .select(WORKER_COLUMNS)
    .eq('is_active', true)
    .or('birth_date.not.is.null,start_date.not.is.null');
  if (error) throw new Error(`celebrations: ${error.message}`);

  const due = upcomingCelebrations(workers ?? [], businessToday(), DAYS_BEFORE)
    .filter((c) => c.daysAway === 0 || c.daysAway === DAYS_BEFORE);

  let sent = 0;
  for (const c of due) {
    const stage = c.daysAway === 0 ? 'day' : 'before';
    const { data: claimed } = await admin
      .from('hr_celebration_notices')
      .upsert(
        { worker_id: c.workerId, kind: c.kind, on_date: c.date, stage },
        { onConflict: 'worker_id,kind,on_date,stage', ignoreDuplicates: true },
      )
      .select('worker_id');
    if (!claimed?.length) continue;

    const { data: recipients, error: recipientsError } = await admin.rpc('hr_celebration_recipients', {
      p_worker_id: c.workerId,
    });
    if (recipientsError) throw new Error(`celebrations: ${recipientsError.message}`);

    const { title, body } = message(c);
    for (const userId of (recipients ?? []) as unknown as string[]) {
      try {
        await sendToUser(userId, {
          title,
          body,
          url: `/hr/${c.workerId}`,
          tag: `celebration-${c.workerId}-${c.kind}-${c.date}-${stage}`,
        });
        sent++;
      } catch (err) {
        console.error('celebrations: send failed', err);
      }
    }
  }
  return { sent };
}
