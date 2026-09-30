'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { coverageConflicts, requiredWindow, workingDays, type CoverageConflict } from '@/domain/absences/coverage';
import { sendToUser } from './push';
import { getAbsenceBrief, getCoverageFor, getWorkingHours } from './coverage';
import type { ActionResult } from './actions';

/*
 * Coverage writes. Approvers and the absent person plan it (RLS:
 * can_plan_coverage). A conflict — the person is away, or already covering
 * then — comes back as a warning first; saving anyway is the planner's call.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'invalid_time' });
const uuid = z.string().uuid();

const KNOWN = [
  'coverage_grant_not_operational', 'coverage_grant_not_held', 'coverage_grant_locked',
  'not_authorized', 'coverage_absence_not_approved', 'coverage_outside_absence', 'coverage_self', 'coverage_coverer_inactive',
  'coverage_locked', 'coverage_times',
];
function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: KNOWN.find((c) => error.message.includes(c)) ?? error.message };
}
function revalidateCoverage(absenceId?: string) {
  revalidatePath('/absences');
  if (absenceId) revalidatePath(`/absences/${absenceId}`);
  revalidatePath('/dashboard');
}

const hm = (t: string) => t.slice(0, 5);
// In Spanish, like every other server-sent notification.
const dayEs = (d: string) => DateTime.fromISO(d, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.');

async function tell(userId: string, title: string, body: string, absenceId: string) {
  try {
    await sendToUser(userId, { title, body, url: `/absences/${absenceId}`, tag: `coverage-${absenceId}-${userId}` });
  } catch (err) {
    console.error('coverage notice failed', err);
  }
}

/** What a period collides with for that person: their absences, their other coverage. */
async function conflictsFor(
  covererId: string,
  date: string,
  start: string,
  end: string,
  id?: string,
): Promise<CoverageConflict[]> {
  const supabase = createClient();
  const [{ data: away }, { data: theirs }, hours] = await Promise.all([
    supabase.rpc('absence_calendar', { p_from: date, p_to: date }),
    supabase
      .from('coverage_assignments')
      .select('id, absence_id, cover_date, start_time, end_time')
      .eq('coverer_id', covererId)
      .eq('cover_date', date)
      .is('removed_at', null),
    getWorkingHours(),
  ]);
  const entries = (away ?? []) as { id: string; profile_id: string; person_name: string; start_date: string; end_date: string; first_day: 'full' | 'afternoon'; last_day: 'full' | 'morning' }[];
  const nameOf = new Map(entries.map((a) => [a.id, a.person_name]));
  return coverageConflicts(
    { date, start, end, id },
    entries.filter((a) => a.profile_id === covererId),
    (theirs ?? []).map((c) => ({ ...c, covering: nameOf.get(c.absence_id) ?? '—' })),
    hours,
  );
}

const coverageSchema = z
  .object({
    absence_id: uuid,
    coverer_id: uuid,
    cover_date: DATE,
    start_time: TIME,
    end_time: TIME,
    note: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
  })
  .refine((c) => hm(c.end_time) > hm(c.start_time), { message: 'coverage_times' });

export type CoverageInput = z.input<typeof coverageSchema>;
export type CoverageResult = ActionResult<{ saved: boolean; conflicts: CoverageConflict[] }>;

const permissionsSchema = z.array(z.string().min(1).max(80)).max(40);

/**
 * The permissions standing with a period become exactly these: the ones no
 * longer wanted are revoked (kept, for the history), new ones given. The
 * database refuses anything not operational, or not the planner's to give.
 */
async function setGrants(assignmentIds: string[], wanted: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!assignmentIds.length) return { ok: true };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: live, error: readError } = await supabase
    .from('coverage_permission_grants')
    .select('id, assignment_id, permission')
    .in('assignment_id', assignmentIds)
    .is('revoked_at', null);
  if (readError) return fail(readError);
  const stale = (live ?? []).filter((g) => !wanted.includes(g.permission)).map((g) => g.id);
  if (stale.length) {
    const { error } = await supabase
      .from('coverage_permission_grants')
      .update({ revoked_at: new Date().toISOString(), revoked_by: user?.id ?? null })
      .in('id', stale);
    if (error) return fail(error);
  }
  const missing = assignmentIds.flatMap((assignment_id) =>
    wanted
      .filter((permission) => !(live ?? []).some((g) => g.assignment_id === assignment_id && g.permission === permission))
      .map((permission) => ({ assignment_id, permission, granted_by: user?.id ?? null })),
  );
  if (missing.length) {
    const { error } = await supabase.from('coverage_permission_grants').insert(missing);
    if (error) return fail(error);
  }
  return { ok: true };
}

/**
 * Someone covers on a day from–until. With a conflict and no `force`,
 * nothing is saved and the conflicts come back to be shown.
 */
export async function saveCoverage(
  input: CoverageInput,
  id?: string,
  force = false,
  /** The permissions given with it; undefined leaves them as they are. */
  permissions?: string[],
): Promise<CoverageResult> {
  const parsed = coverageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_coverage' };
  const perms = permissions === undefined ? null : permissionsSchema.safeParse(permissions);
  if (perms && !perms.success) return { ok: false, error: 'invalid_coverage' };
  const v = parsed.data;
  const conflicts = await conflictsFor(v.coverer_id, v.cover_date, hm(v.start_time), hm(v.end_time), id);
  if (conflicts.length && !force) return { ok: true, data: { saved: false, conflicts } };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const before = id
    ? (await supabase.from('coverage_assignments').select('coverer_id, cover_date, start_time, end_time').eq('id', id).maybeSingle()).data
    : null;
  const { data: saved, error } = id
    ? await supabase.from('coverage_assignments').update(v).eq('id', id).is('removed_at', null).select('id')
    : await supabase.from('coverage_assignments').insert({ ...v, created_by: user?.id ?? null }).select('id');
  if (error) return fail(error);
  const savedId = saved?.[0]?.id;
  if (!savedId) return { ok: false, error: 'not_authorized' };
  // A period given to someone else lost its grants (they were that person's); set them again.
  if (perms?.success) {
    const granted = await setGrants([savedId], perms.data);
    if (!granted.ok) return granted;
  }

  const brief = await getAbsenceBrief(v.absence_id);
  const who = brief?.person_name ?? '';
  const when = `${dayEs(v.cover_date)} ${hm(v.start_time)}–${hm(v.end_time)}`;
  if (before && before.coverer_id !== v.coverer_id) {
    await tell(before.coverer_id, 'Ya no cubres una ausencia', `${who}: ${dayEs(before.cover_date)} ${hm(before.start_time)}–${hm(before.end_time)}`, v.absence_id);
  }
  const changedForThem =
    !before ||
    before.coverer_id !== v.coverer_id ||
    before.cover_date !== v.cover_date ||
    hm(before.start_time) !== hm(v.start_time) ||
    hm(before.end_time) !== hm(v.end_time);
  if (changedForThem) {
    await tell(v.coverer_id, before && before.coverer_id === v.coverer_id ? 'Tu cobertura cambió' : 'Cubres una ausencia', `${who}: ${when}`, v.absence_id);
  }
  revalidateCoverage(v.absence_id);
  return { ok: true, data: { saved: true, conflicts } };
}

/**
 * One person covers every working day still without anyone: the whole
 * working window of each. Conflicts first, as with a single period.
 */
export async function coverAllDays(
  absenceId: string,
  covererId: string,
  force = false,
  permissions: string[] = [],
): Promise<CoverageResult> {
  if (!uuid.safeParse(absenceId).success || !uuid.safeParse(covererId).success) return { ok: false, error: 'invalid_coverage' };
  const perms = permissionsSchema.safeParse(permissions);
  if (!perms.success) return { ok: false, error: 'invalid_coverage' };
  const [brief, hours, existing] = await Promise.all([getAbsenceBrief(absenceId), getWorkingHours(), getCoverageFor(absenceId)]);
  if (!brief) return { ok: false, error: 'not_authorized' };
  const days = workingDays(brief, hours)
    .map((date) => ({ date, window: requiredWindow(brief, date, hours) }))
    .filter((d): d is { date: string; window: { start: string; end: string } } => !!d.window)
    // Only days nobody covers yet; partly covered days are left to plan by hand.
    .filter((d) => !existing.some((c) => c.cover_date === d.date));
  if (days.length === 0) return { ok: true, data: { saved: false, conflicts: [] } };

  const conflicts = (await Promise.all(days.map((d) => conflictsFor(covererId, d.date, d.window.start, d.window.end)))).flat();
  if (conflicts.length && !force) return { ok: true, data: { saved: false, conflicts } };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: created, error } = await supabase
    .from('coverage_assignments')
    .insert(
      days.map((d) => ({
        absence_id: absenceId,
        coverer_id: covererId,
        cover_date: d.date,
        start_time: d.window.start,
        end_time: d.window.end,
        created_by: user?.id ?? null,
      })),
    )
    .select('id');
  if (error) return fail(error);
  if (perms.data.length) {
    const granted = await setGrants((created ?? []).map((c) => c.id), perms.data);
    if (!granted.ok) return granted;
  }
  const span = days.length === 1 ? dayEs(days[0].date) : `${dayEs(days[0].date)} – ${dayEs(days[days.length - 1].date)} (${days.length} días)`;
  await tell(covererId, 'Cubres una ausencia', `${brief.person_name}: ${span}`, absenceId);
  revalidateCoverage(absenceId);
  return { ok: true, data: { saved: true, conflicts } };
}

/** Off the plan. Kept, marked removed, for the history; the person is told. */
export async function removeCoverage(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'invalid_coverage' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('coverage_assignments')
    .update({ removed_at: new Date().toISOString(), removed_by: user?.id ?? null })
    .eq('id', id)
    .is('removed_at', null)
    .select('absence_id, coverer_id, cover_date, start_time, end_time');
  if (error) return fail(error);
  const row = data?.[0];
  if (!row) return { ok: false, error: 'not_authorized' };
  const brief = await getAbsenceBrief(row.absence_id);
  await tell(row.coverer_id, 'Ya no cubres una ausencia', `${brief?.person_name ?? ''}: ${dayEs(row.cover_date)} ${hm(row.start_time)}–${hm(row.end_time)}`, row.absence_id);
  revalidateCoverage(row.absence_id);
  return { ok: true, data: undefined };
}

/* ----------------------------- Admin's settings ---------------------------- */

const hoursSchema = z
  .object({
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    start: TIME,
    noon: TIME,
    end: TIME,
  })
  .refine((h) => hm(h.start) < hm(h.noon) && hm(h.noon) < hm(h.end), { message: 'invalid_hours' });

/** The working week coverage fills (RLS on app_settings: admin writes). */
export async function saveWorkingHours(input: z.input<typeof hoursSchema>): Promise<ActionResult> {
  const parsed = hoursSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_hours' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const value = { ...parsed.data, days: [...new Set(parsed.data.days)].sort(), start: hm(parsed.data.start), noon: hm(parsed.data.noon), end: hm(parsed.data.end) };
  const { error } = await supabase.from('app_settings').upsert({ key: 'absences.hours', value, updated_by: user?.id ?? null });
  if (error) return fail(error);
  revalidatePath('/admin/absences');
  revalidateCoverage();
  return { ok: true, data: undefined };
}

/** Who must be covered when away — the whole list at once (RLS: is_admin). */
export async function setNeedsCover(ids: string[]): Promise<ActionResult> {
  const parsed = z.array(uuid).max(200).safeParse([...new Set(ids)]);
  if (!parsed.success) return { ok: false, error: 'invalid_entry' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: current, error: readError } = await supabase.from('absence_needs_cover').select('profile_id');
  if (readError) return fail(readError);
  const before = (current ?? []).map((r) => r.profile_id);
  const added = parsed.data.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !parsed.data.includes(id));
  if (added.length) {
    const { error } = await supabase.from('absence_needs_cover').insert(added.map((profile_id) => ({ profile_id, added_by: user?.id ?? null })));
    if (error) return fail(error);
  }
  if (removed.length) {
    const { error } = await supabase.from('absence_needs_cover').delete().in('profile_id', removed);
    if (error) return fail(error);
  }
  revalidatePath('/admin/absences');
  revalidateCoverage();
  return { ok: true, data: undefined };
}
