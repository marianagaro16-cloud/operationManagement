/**
 * When someone's next evaluation is due (2026-10-22).
 *
 * Each team has a number of months (Gestión; a team without one has no rule).
 * Next = the last evaluation + those months — one written on the file or one
 * sent to several people, counted on the day it was sent. Someone never
 * evaluated is due at the end of the trial period when that is set, else the
 * start date + the months.
 */
import type { Team } from '@/lib/authz';

/** app_settings 'hr_eval_interval_months'. */
export type EvalIntervals = Partial<Record<Team, number>>;

/** Some months on, the same day of the month or the month's last day. */
export function plusMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Each worker's latest evaluation day, of either kind. */
export function lastEvaluations(
  evaluations: { worker_id: string; evaluated_on: string }[],
  requests: { worker_id: string; created_at: string }[],
): Map<string, string> {
  const last = new Map<string, string>();
  const see = (id: string, day: string) => {
    if ((last.get(id) ?? '') < day) last.set(id, day);
  };
  for (const e of evaluations) see(e.worker_id, e.evaluated_on);
  for (const r of requests) see(r.worker_id, r.created_at.slice(0, 10));
  return last;
}

export function nextEvaluation(
  worker: { team: Team; start_date: string | null; trial_end_date: string | null },
  lastEvaluatedOn: string | null | undefined,
  intervals: EvalIntervals,
): string | null {
  const months = intervals[worker.team];
  if (!months) return null;
  if (lastEvaluatedOn) return plusMonths(lastEvaluatedOn, months);
  if (worker.trial_end_date) return worker.trial_end_date;
  if (worker.start_date) return plusMonths(worker.start_date, months);
  return null;
}
