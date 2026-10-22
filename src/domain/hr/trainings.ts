/**
 * Training and certificates (2026-10-22). Pure, so the file, the HR list and
 * the notices agree on what counts.
 *
 * Only someone's LATEST training of a kind counts: doing HACCP again replaces
 * the old certificate, so the old expiry neither warns nor makes it "expired".
 */
import { DATE_NOTICE_DAYS, type CustomDate } from './important-dates';
import type { Team } from '@/lib/authz';

export interface TrainingKindRule {
  id: string;
  name: string;
  validity_months: number | null;
  required_teams: Team[];
  is_active: boolean;
}

export interface TrainingRecord {
  id: string;
  worker_id: string;
  kind_id: string;
  done_on: string;
  expires_on: string | null;
}

export type TrainingStatus = 'ok' | 'expiring' | 'expired' | 'missing';

/** The latest training of each kind per worker, keyed 'worker:kind'. */
export function latestTrainings<T extends TrainingRecord>(trainings: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const t of trainings) {
    const key = `${t.worker_id}:${t.kind_id}`;
    const current = latest.get(key);
    if (!current || current.done_on < t.done_on) latest.set(key, t);
  }
  return latest;
}

/** When the latest training of each kind expires, as dates for the notices and lists. */
export function trainingExpiries(trainings: TrainingRecord[], kinds: Pick<TrainingKindRule, 'id' | 'name'>[]): CustomDate[] {
  const names = new Map(kinds.map((k) => [k.id, k.name]));
  return [...latestTrainings(trainings).values()]
    .filter((t) => t.expires_on)
    .map((t) => ({ id: t.id, worker_id: t.worker_id, label: names.get(t.kind_id) ?? '', on_date: t.expires_on! }));
}

/** A training's expiry by its kind's validity: 1 Oct + 24 months ends 30 Sep two years on. */
export function defaultExpiry(doneOn: string, validityMonths: number | null): string | null {
  if (!validityMonths) return null;
  const d = new Date(`${doneOn}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + validityMonths);
  // The same day of the month, or the month's last day when it has fewer.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** How one latest training stands today. */
export function trainingStatus(latest: Pick<TrainingRecord, 'expires_on'> | undefined, today: string): TrainingStatus {
  if (!latest) return 'missing';
  if (!latest.expires_on) return 'ok';
  const days = dayNumber(latest.expires_on) - dayNumber(today);
  if (days < 0) return 'expired';
  return days <= DATE_NOTICE_DAYS ? 'expiring' : 'ok';
}

/** The kinds a worker's team must have, each with how it stands. */
export function requiredTrainings<T extends TrainingRecord>(
  worker: { id: string; team: Team },
  kinds: TrainingKindRule[],
  trainings: T[],
  today: string,
): { kind: TrainingKindRule; latest: T | undefined; status: TrainingStatus }[] {
  const latest = latestTrainings(trainings.filter((t) => t.worker_id === worker.id));
  return kinds
    .filter((k) => k.is_active && k.required_teams.includes(worker.team))
    .map((kind) => {
      const l = latest.get(`${worker.id}:${kind.id}`);
      return { kind, latest: l, status: trainingStatus(l, today) };
    });
}
