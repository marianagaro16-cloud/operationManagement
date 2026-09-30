import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  absenceGaps,
  coverageConflicts,
  daysAwayIn,
  minutesBetween,
  type CoverageConflict,
  type Period,
} from '@/domain/absences/coverage';
import { getAbsences } from './absences';
import { getNeedsCoverIds, getWorkingHours } from './coverage';

/*
 * The absence and coverage report, for approvers (RLS gives them every row):
 * over a period, who was away how long, who covered how much, what stayed
 * uncovered, which periods collided, which permissions were given, and the
 * history of it all.
 */

export interface AbsenceReport {
  people: { profile_id: string; name: string; days: number; byType: Record<string, number>; pending: number }[];
  coverers: { profile_id: string; name: string; minutes: number; periods: number }[];
  uncovered: { absence_id: string; name: string; days: { date: string; gaps: Period[] }[] }[];
  conflicts: { assignment_id: string; absence_id: string; coverer: string; covering: string; date: string; start: string; end: string; conflicts: CoverageConflict[] }[];
  grants: { coverer: string; covering: string; permission: string; date: string; start: string; end: string; by: string | null; revoked: boolean }[];
  history: { at: string; kind: 'absence' | 'coverage' | 'handover'; action: string; actor: string | null; about: string; absence_id: string }[];
}

type Person = { name: string | null; email: string } | null;
const nameOf = (p: Person) => (p ? p.name || p.email : '—');

export async function getAbsenceReport(from: string, to: string): Promise<AbsenceReport> {
  const supabase = createClient();
  const [absences, hours, needs, { data: cov }, { data: absEvents }, { data: covEvents }, { data: hoEvents }] = await Promise.all([
    getAbsences({ from, to }, 1000),
    getWorkingHours(),
    getNeedsCoverIds(),
    supabase
      .from('coverage_assignments')
      .select(
        'id, absence_id, coverer_id, cover_date, start_time, end_time, coverer:profiles!coverage_assignments_coverer_id_fkey ( name, email ), grants:coverage_permission_grants ( permission, revoked_at, giver:profiles!coverage_permission_grants_granted_by_fkey ( name, email ) )',
      )
      .is('removed_at', null)
      .gte('cover_date', from)
      .lte('cover_date', to),
    supabase
      .from('absence_events')
      .select('absence_id, action, created_at, actor:profiles ( name, email )')
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('coverage_events')
      .select('absence_id, action, detail, created_at, actor:profiles ( name, email )')
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('handover_events')
      .select('absence_id, action, detail, created_at, actor:profiles ( name, email )')
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const approved = absences.filter((a) => a.status === 'approved');
  const absenceById = new Map(absences.map((a) => [a.id, a]));

  // Who was away how long.
  const people = new Map<string, AbsenceReport['people'][number]>();
  for (const a of absences) {
    const p = people.get(a.profile_id) ?? { profile_id: a.profile_id, name: a.person_name, days: 0, byType: {}, pending: 0 };
    if (a.status === 'approved') {
      const n = daysAwayIn(a, from, to, hours);
      p.days += n;
      p.byType[a.type_id] = (p.byType[a.type_id] ?? 0) + n;
    }
    if (a.status === 'pending') p.pending++;
    people.set(a.profile_id, p);
  }

  type Cov = {
    id: string;
    absence_id: string;
    coverer_id: string;
    cover_date: string;
    start_time: string;
    end_time: string;
    coverer: Person;
    grants: { permission: string; revoked_at: string | null; giver: Person }[] | null;
  };
  const coverage = ((cov ?? []) as unknown as Cov[]).filter((c) => absenceById.get(c.absence_id)?.status === 'approved');

  // Who covered how much.
  const coverers = new Map<string, AbsenceReport['coverers'][number]>();
  for (const c of coverage) {
    const e = coverers.get(c.coverer_id) ?? { profile_id: c.coverer_id, name: nameOf(c.coverer), minutes: 0, periods: 0 };
    e.minutes += minutesBetween(c.start_time, c.end_time);
    e.periods++;
    coverers.set(c.coverer_id, e);
  }

  // What stayed uncovered, for the people who must be covered.
  const uncovered = approved
    .filter((a) => needs.includes(a.profile_id))
    .map((a) => ({
      absence_id: a.id,
      name: a.person_name,
      days: absenceGaps(a, hours, coverage.filter((c) => c.absence_id === a.id)).filter((d) => d.date >= from && d.date <= to),
    }))
    .filter((u) => u.days.length > 0);

  // Which periods collided: the person covering was away, or already covering then.
  const conflicts = coverage
    .map((c) => {
      const theirAbsences = approved.filter((a) => a.profile_id === c.coverer_id);
      const theirCoverage = coverage
        .filter((o) => o.coverer_id === c.coverer_id)
        .map((o) => ({ ...o, covering: absenceById.get(o.absence_id)?.person_name ?? '—' }));
      return {
        assignment_id: c.id,
        absence_id: c.absence_id,
        coverer: nameOf(c.coverer),
        covering: absenceById.get(c.absence_id)?.person_name ?? '—',
        date: c.cover_date,
        start: c.start_time.slice(0, 5),
        end: c.end_time.slice(0, 5),
        conflicts: coverageConflicts({ date: c.cover_date, start: c.start_time.slice(0, 5), end: c.end_time.slice(0, 5), id: c.id }, theirAbsences, theirCoverage, hours),
      };
    })
    .filter((c) => c.conflicts.length > 0);

  // Which permissions were given with coverage.
  const grants = coverage.flatMap((c) =>
    (c.grants ?? []).map((g) => ({
      coverer: nameOf(c.coverer),
      covering: absenceById.get(c.absence_id)?.person_name ?? '—',
      permission: g.permission,
      date: c.cover_date,
      start: c.start_time.slice(0, 5),
      end: c.end_time.slice(0, 5),
      by: g.giver ? nameOf(g.giver) : null,
      revoked: !!g.revoked_at,
    })),
  );

  // The history of it all, latest first.
  type Ev = { absence_id: string; action: string; created_at: string; actor: Person };
  const about = (id: string) => absenceById.get(id)?.person_name ?? '—';
  const history: AbsenceReport['history'] = [
    ...((absEvents ?? []) as unknown as Ev[]).map((e) => ({ at: e.created_at, kind: 'absence' as const, action: e.action, actor: e.actor ? nameOf(e.actor) : null, about: about(e.absence_id), absence_id: e.absence_id })),
    ...((covEvents ?? []) as unknown as Ev[]).map((e) => ({ at: e.created_at, kind: 'coverage' as const, action: e.action, actor: e.actor ? nameOf(e.actor) : null, about: about(e.absence_id), absence_id: e.absence_id })),
    ...((hoEvents ?? []) as unknown as Ev[]).map((e) => ({ at: e.created_at, kind: 'handover' as const, action: e.action, actor: e.actor ? nameOf(e.actor) : null, about: about(e.absence_id), absence_id: e.absence_id })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 200);

  return {
    people: [...people.values()].sort((a, b) => b.days - a.days),
    coverers: [...coverers.values()].sort((a, b) => b.minutes - a.minutes),
    uncovered,
    conflicts,
    grants,
    history,
  };
}
