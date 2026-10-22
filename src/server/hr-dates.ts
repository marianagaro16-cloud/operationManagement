import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { noticeStage, upcomingImportantDates, DATE_NOTICE_DAYS, type ImportantDate } from '@/domain/hr/important-dates';
import { trainingExpiries } from '@/domain/hr/trainings';
import type { HrWorkerDate } from '@/types/hr';
import { sendToUser } from './push';

/*
 * Important dates on the worker files (2026-10-22).
 *
 * The HR list and Inicio read as the viewer, so RLS decides whose appear —
 * the files they may open. The notifier runs as the system and asks
 * hr_celebration_recipients() who may be told about each person.
 */

/** Notices go out from this hour, Europe/Zurich. */
const NOTICE_HOUR = 9;

const WORKER_COLUMNS = 'id, name, trial_end_date, contract_end_date';

/** The custom dates of one file, soonest first. */
export async function getWorkerDates(workerId: string): Promise<HrWorkerDate[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('hr_worker_dates')
    .select('id, worker_id, label, on_date, note')
    .eq('worker_id', workerId)
    .order('on_date');
  return (data ?? []) as HrWorkerDate[];
}

/** As the viewer (RLS decides whose), or as the system for the notifier. */
async function upcoming(asSystem: boolean, today: string, days: number): Promise<ImportantDate[]> {
  const client = asSystem ? createAdminClient() : createClient();
  const until = DateTime.fromISO(today, { zone: BUSINESS_TZ }).plus({ days }).toISODate()!;
  const [{ data: workers, error }, { data: custom, error: customError }, { data: trainings, error: trainingError }, { data: kinds }] = await Promise.all([
    client.from('hr_workers').select(WORKER_COLUMNS).eq('is_active', true),
    client.from('hr_worker_dates').select('id, worker_id, label, on_date').gte('on_date', today).lte('on_date', until),
    // All of them: whether an expiry still counts depends on a newer training of the kind.
    client.from('hr_trainings').select('id, worker_id, kind_id, done_on, expires_on'),
    client.from('hr_training_kinds').select('id, name'),
  ]);
  if (error || customError || trainingError) throw new Error(`hr dates: ${(error ?? customError ?? trainingError)!.message}`);
  return upcomingImportantDates(workers ?? [], custom ?? [], today, days, trainingExpiries(trainings ?? [], kinds ?? []));
}

/** What falls in the coming 30 days among the files the viewer may open. Current staff only. */
export async function getUpcomingHrDates(): Promise<ImportantDate[]> {
  try {
    return await upcoming(false, businessToday(), DATE_NOTICE_DAYS);
  } catch {
    return [];
  }
}

const day = (date: string) => DateTime.fromISO(date, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.yyyy');

const WHAT: Record<ImportantDate['kind'], string> = {
  trial_end: 'Fin del periodo de prueba',
  contract_end: 'Fin del contrato',
  custom: '',
  training: 'Vence la formación',
};

/** "Fin del contrato" mid-sentence, without touching a name like HACCP. */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Written in Spanish, like every other server-sent notification. */
function message(d: ImportantDate): { title: string; body: string } {
  const what = d.kind === 'custom' ? d.label ?? '' : d.kind === 'training' ? `${WHAT.training} ${d.label ?? ''}`.trim() : WHAT[d.kind];
  return d.daysAway === 0
    ? { title: `${what} hoy`, body: `${d.workerName}: ${lowerFirst(what)} es hoy.` }
    : { title: what, body: `${d.workerName}: ${lowerFirst(what)} el ${day(d.date)} (en ${d.daysAway === 1 ? '1 día' : `${d.daysAway} días`}).` };
}

/**
 * Tell whoever may see the file: once within the 30 days before, and on the
 * day. Called every few minutes by the reminders cron; each notice is claimed
 * before it is sent, so overlapping runs never send one twice.
 */
export async function runHrDateNotices(now = new Date()): Promise<{ sent: number }> {
  if (DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).hour < NOTICE_HOUR) return { sent: 0 };

  const admin = createAdminClient();
  const due = (await upcoming(true, businessToday(), DATE_NOTICE_DAYS))
    .map((d) => ({ d, stage: noticeStage(d.daysAway) }))
    .filter((x): x is { d: ImportantDate; stage: 'before' | 'day' } => x.stage !== null);

  let sent = 0;
  for (const { d, stage } of due) {
    const { data: claimed } = await admin
      .from('hr_date_notices')
      .upsert(
        { kind: d.kind, ref_id: d.refId, on_date: d.date, stage },
        { onConflict: 'kind,ref_id,on_date,stage', ignoreDuplicates: true },
      )
      .select('ref_id');
    if (!claimed?.length) continue;

    const { data: recipients, error } = await admin.rpc('hr_celebration_recipients', { p_worker_id: d.workerId });
    if (error) throw new Error(`hr dates: ${error.message}`);

    const { title, body } = message(d);
    for (const userId of (recipients ?? []) as unknown as string[]) {
      try {
        await sendToUser(userId, {
          title,
          body,
          url: `/hr/${d.workerId}`,
          tag: `hr-date-${d.kind}-${d.refId}-${d.date}-${stage}`,
        });
        sent++;
      } catch (err) {
        console.error('hr dates: send failed', err);
      }
    }
  }
  return { sent };
}
