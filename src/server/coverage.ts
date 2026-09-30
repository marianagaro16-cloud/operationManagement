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

const COLUMNS = 'id, absence_id, coverer_id, cover_date, start_time, end_time, note, coverer:profiles!coverage_assignments_coverer_id_fkey ( name, email )';

type Raw = Omit<CoverageAssignment, 'coverer_name'> & { coverer: { name: string | null; email: string } | null };
const toAssignment = ({ coverer, ...c }: Raw): CoverageAssignment => ({
  ...c,
  coverer_name: coverer ? coverer.name || coverer.email : '—',
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
