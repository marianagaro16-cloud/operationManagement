import 'server-only';
import { DateTime } from 'luxon';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { DEFAULT_HOURS, absenceGaps, type WorkingHours } from '@/domain/absences/coverage';
import type { AbsenceCalendarEntry, CoverageAssignment, CoverageEntry } from '@/types/absences';
import { getAbsenceCalendar, isAbsenceApprover } from './absences';

/*
 * Coverage reads. Everyone with an account sees the plan; who is away comes
 * from absence_calendar(), which never carries the type or the note.
 */

const COLUMNS =
  'id, absence_id, coverer_id, cover_date, start_time, end_time, note, coverer:profiles!coverage_assignments_coverer_id_fkey ( name, email ), grants:coverage_permission_grants ( permission, revoked_at )';

type Raw = Omit<CoverageAssignment, 'coverer_name' | 'permissions'> & {
  coverer: { name: string | null; email: string } | null;
  grants: { permission: string; revoked_at: string | null }[] | null;
};
const toAssignment = ({ coverer, grants, ...c }: Raw): CoverageAssignment => ({
  ...c,
  coverer_name: coverer ? coverer.name || coverer.email : '—',
  // Only the ones still standing.
  permissions: (grants ?? []).filter((g) => !g.revoked_at).map((g) => g.permission),
});

/** The working week coverage has to fill (Gestión → Ausencias). */
export async function getWorkingHours(): Promise<WorkingHours> {
  const supabase = createClient();
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'absences.hours').maybeSingle();
  const v = data?.value as Partial<WorkingHours> | undefined;
  return {
    days: Array.isArray(v?.days) ? v.days.map(Number) : DEFAULT_HOURS.days,
    start: v?.start ?? DEFAULT_HOURS.start,
    noon: v?.noon ?? DEFAULT_HOURS.noon,
    end: v?.end ?? DEFAULT_HOURS.end,
  };
}

/** The people who must be covered when away. */
export async function getNeedsCoverIds(): Promise<string[]> {
  const supabase = createClient();
  const { data } = await supabase.from('absence_needs_cover').select('profile_id');
  return (data ?? []).map((r) => r.profile_id);
}

/** An absence as everyone may see it; null when the viewer may not. */
export async function getAbsenceBrief(id: string): Promise<(AbsenceCalendarEntry & { status: string }) | null> {
  const supabase = createClient();
  const { data } = await supabase.rpc('absence_brief', { p_absence_id: id });
  return ((data ?? []) as (AbsenceCalendarEntry & { status: string })[])[0] ?? null;
}

/** An absence's coverage, by day and time. */
export async function getCoverageFor(absenceId: string): Promise<CoverageAssignment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('coverage_assignments')
    .select(COLUMNS)
    .eq('absence_id', absenceId)
    .is('removed_at', null)
    .order('cover_date')
    .order('start_time');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Raw[]).map(toAssignment);
}

/** Who is away between two days, and who covers them when. */
export async function getCoverageBetween(from: string, to: string): Promise<{ away: AbsenceCalendarEntry[]; coverage: CoverageEntry[] }> {
  const supabase = createClient();
  const [away, { data, error }] = await Promise.all([
    getAbsenceCalendar(from, to),
    supabase
      .from('coverage_assignments')
      .select(COLUMNS)
      .is('removed_at', null)
      .gte('cover_date', from)
      .lte('cover_date', to)
      .order('cover_date')
      .order('start_time'),
  ]);
  if (error) throw new Error(error.message);
  const byAbsence = new Map(away.map((a) => [a.id, a]));
  const coverage = ((data ?? []) as unknown as Raw[])
    .map(toAssignment)
    .filter((c) => byAbsence.has(c.absence_id))
    .map((c) => ({ ...c, absent_profile_id: byAbsence.get(c.absence_id)!.profile_id, absent_name: byAbsence.get(c.absence_id)!.person_name }));
  return { away, coverage };
}

/** What the viewer covers from today on. */
export async function getMyCoverage(today: string): Promise<CoverageEntry[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const until = DateTime.fromISO(today, { zone: BUSINESS_TZ }).plus({ days: 120 }).toISODate()!;
  const { coverage } = await getCoverageBetween(today, until);
  return coverage.filter((c) => c.coverer_id === user.id);
}

/**
 * Absences of people who must be covered, in the next two weeks, with time
 * still uncovered. An approver counts everyone's; anyone else their own.
 */
export async function countCoverageGaps(today: string, viewerId: string): Promise<number> {
  const until = DateTime.fromISO(today, { zone: BUSINESS_TZ }).plus({ days: 14 }).toISODate()!;
  const [{ away, coverage }, needs, hours, approver] = await Promise.all([
    getCoverageBetween(today, until),
    getNeedsCoverIds(),
    getWorkingHours(),
    isAbsenceApprover(),
  ]);
  return away
    .filter((a) => needs.includes(a.profile_id) && (approver || a.profile_id === viewerId))
    .filter((a) => {
      // Only what is still ahead counts.
      const ahead = { ...a, start_date: a.start_date < today ? today : a.start_date, first_day: a.start_date < today ? 'full' as const : a.first_day };
      return absenceGaps(ahead, hours, coverage.filter((c) => c.absence_id === a.id)).length > 0;
    }).length;
}

/**
 * The work of the people the viewer covers right now: their activities due
 * today or overdue, and their open inventories. RLS returns them only while
 * the coverage lasts — before or after, nothing.
 */
export async function getCoveredWork(
  absentIds: string[],
  today: string,
): Promise<{
  activities: { id: string; assignee_id: string; due: string; title: string; translations: unknown }[];
  inventories: { id: string; assignee_ids: string[]; date: string; name: string }[];
}> {
  if (!absentIds.length) return { activities: [], inventories: [] };
  const supabase = createClient();
  const [{ data: occ }, { data: inv }] = await Promise.all([
    supabase
      .from('task_occurrences')
      .select('id, assignee_id, effective_due_date, task:tasks!inner ( title, translations )')
      .in('assignee_id', absentIds)
      .in('status', ['pending', 'blocked'])
      .lte('effective_due_date', today)
      .order('effective_due_date'),
    supabase
      .from('inventory_assignments')
      .select('user_id, instance:inventory_instances!inner ( id, inventory_date, name_snapshot, completed_at )')
      .in('user_id', absentIds)
      .is('instance.completed_at', null)
      .lte('instance.inventory_date', today),
  ]);
  type Occ = { id: string; assignee_id: string; effective_due_date: string; task: { title: string; translations: unknown } };
  type Inv = { user_id: string; instance: { id: string; inventory_date: string; name_snapshot: string } };
  const byInstance = new Map<string, { id: string; assignee_ids: string[]; date: string; name: string }>();
  for (const r of (inv ?? []) as unknown as Inv[]) {
    const e = byInstance.get(r.instance.id) ?? { id: r.instance.id, assignee_ids: [], date: r.instance.inventory_date, name: r.instance.name_snapshot };
    e.assignee_ids.push(r.user_id);
    byInstance.set(r.instance.id, e);
  }
  return {
    activities: ((occ ?? []) as unknown as Occ[]).map((o) => ({
      id: o.id,
      assignee_id: o.assignee_id,
      due: o.effective_due_date,
      title: o.task.title,
      translations: o.task.translations,
    })),
    inventories: [...byInstance.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
