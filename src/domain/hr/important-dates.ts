/**
 * A worker file's important dates (2026-10-22): the end of the trial period,
 * the end of a fixed-term contract, and any other date HR keeps on the file.
 * HR is told within the 30 days before and on the day.
 *
 * Pure, so the file, the HR list, Inicio and the notifier agree on what is
 * coming up.
 */

export type ImportantDateKind = 'trial_end' | 'contract_end' | 'custom' | 'training' | 'evaluation';

/** How far ahead HR is told, and the HR list and Inicio look. */
export const DATE_NOTICE_DAYS = 30;

export interface ImportantDate {
  kind: ImportantDateKind;
  /** The worker for trial_end, contract_end and evaluation, the hr_worker_dates row for custom, the hr_trainings row for training. */
  refId: string;
  workerId: string;
  workerName: string;
  /** The name HR gave a custom date, or the training's; null for the other two. */
  label: string | null;
  date: string;
  /** Days from today; negative once it has passed. */
  daysAway: number;
}

export interface DatedWorker {
  id: string;
  name: string;
  trial_end_date: string | null;
  contract_end_date: string | null;
}

export interface CustomDate {
  id: string;
  worker_id: string;
  label: string;
  on_date: string;
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * Every date of these workers, soonest first. Trainings: when each expires
 * (see trainingExpiries). Evaluations: when the next is due (see nextEvaluation).
 */
export function allImportantDates(
  workers: DatedWorker[],
  custom: CustomDate[],
  today: string,
  trainings: CustomDate[] = [],
  evaluations: { worker_id: string; on_date: string }[] = [],
): ImportantDate[] {
  const names = new Map(workers.map((w) => [w.id, w.name]));
  const away = (date: string) => Math.round(dayNumber(date) - dayNumber(today));
  const dates: ImportantDate[] = [];
  for (const w of workers) {
    if (w.trial_end_date) dates.push({ kind: 'trial_end', refId: w.id, workerId: w.id, workerName: w.name, label: null, date: w.trial_end_date, daysAway: away(w.trial_end_date) });
    if (w.contract_end_date) dates.push({ kind: 'contract_end', refId: w.id, workerId: w.id, workerName: w.name, label: null, date: w.contract_end_date, daysAway: away(w.contract_end_date) });
  }
  for (const e of evaluations) {
    const name = names.get(e.worker_id);
    if (name !== undefined) dates.push({ kind: 'evaluation', refId: e.worker_id, workerId: e.worker_id, workerName: name, label: null, date: e.on_date, daysAway: away(e.on_date) });
  }
  for (const [kind, list] of [['custom', custom], ['training', trainings]] as const) {
    for (const c of list) {
      const name = names.get(c.worker_id);
      if (name !== undefined) dates.push({ kind, refId: c.id, workerId: c.worker_id, workerName: name, label: c.label, date: c.on_date, daysAway: away(c.on_date) });
    }
  }
  return dates.sort((a, b) => a.date.localeCompare(b.date) || a.workerName.localeCompare(b.workerName));
}

/** What falls from today to `days` ahead. */
export function upcomingImportantDates(
  workers: DatedWorker[],
  custom: CustomDate[],
  today: string,
  days = DATE_NOTICE_DAYS,
  trainings: CustomDate[] = [],
  evaluations: { worker_id: string; on_date: string }[] = [],
): ImportantDate[] {
  return allImportantDates(workers, custom, today, trainings, evaluations).filter((d) => d.daysAway >= 0 && d.daysAway <= days);
}

/**
 * Which notice a date is due: 'day' on the day, 'before' any day within the
 * 30 before — once per date, so a date entered 10 days ahead is still told.
 */
export function noticeStage(daysAway: number): 'before' | 'day' | null {
  if (daysAway === 0) return 'day';
  if (daysAway > 0 && daysAway <= DATE_NOTICE_DAYS) return 'before';
  return null;
}
