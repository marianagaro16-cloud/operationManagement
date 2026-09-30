import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AbsenceCalendarEntry, AbsenceEvent, AbsenceRow, AbsenceStatus, AbsenceType } from '@/types/absences';

/*
 * Absences reads. RLS decides: the whole row for the person and the
 * approvers; who is away and when, for everyone, through absence_calendar().
 */

const ABSENCE_COLUMNS = `
  id, profile_id, type_id, start_date, end_date, first_day, last_day, start_time, end_time, note, status,
  decided_at, rejection_reason, cancelled_at, created_at,
  person:profiles!absences_profile_id_fkey ( name, email ),
  decider:profiles!absences_decided_by_fkey ( name, email )
`;

type Person = { name: string | null; email: string } | null;
const nameOf = (p: Person) => (p ? p.name || p.email : null);

function toAbsence(row: unknown): AbsenceRow {
  const { person, decider, ...a } = row as Omit<AbsenceRow, 'person_name' | 'decider_name'> & { person: Person; decider: Person };
  return { ...a, person_name: nameOf(person) ?? '—', decider_name: nameOf(decider) };
}

export async function isAbsenceApprover(): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.rpc('is_absence_approver');
  return data === true;
}

/** The viewer's own absences, latest first. */
export async function getMyAbsences(): Promise<AbsenceRow[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('absences')
    .select(ABSENCE_COLUMNS)
    .eq('profile_id', user.id)
    .order('start_date', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toAbsence);
}

/** Requests waiting for a decision — not the approver's own. Soonest first. */
export async function getPendingAbsences(): Promise<AbsenceRow[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('absences')
    .select(ABSENCE_COLUMNS)
    .eq('status', 'pending')
    .neq('profile_id', user?.id ?? '')
    .order('start_date');
  if (error) throw new Error(error.message);
  return (data ?? []).map(toAbsence);
}

export async function countPendingAbsences(): Promise<number> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { count } = await supabase
    .from('absences')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .neq('profile_id', user?.id ?? '');
  return count ?? 0;
}

export interface AbsenceFilters {
  profileId?: string;
  status?: AbsenceStatus;
  typeId?: string;
  from?: string;
  to?: string;
}

/** Every absence, for the approvers, filtered; the latest first. */
export async function getAbsences(filters: AbsenceFilters, limit = 100): Promise<AbsenceRow[]> {
  const supabase = createClient();
  let q = supabase.from('absences').select(ABSENCE_COLUMNS);
  if (filters.profileId) q = q.eq('profile_id', filters.profileId);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.typeId) q = q.eq('type_id', filters.typeId);
  if (filters.from) q = q.gte('end_date', filters.from);
  if (filters.to) q = q.lte('start_date', filters.to);
  const { data, error } = await q.order('start_date', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toAbsence);
}

/** Who is away between two days: approved absences, for everyone. */
export async function getAbsenceCalendar(from: string, to: string): Promise<AbsenceCalendarEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('absence_calendar', { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as AbsenceCalendarEntry[];
}

export async function getAbsenceEvents(absenceId: string): Promise<AbsenceEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('absence_events')
    .select('id, action, created_at, actor:profiles ( name, email )')
    .eq('absence_id', absenceId)
    .order('created_at');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (Omit<AbsenceEvent, 'actor_name'> & { actor: Person })[]).map(({ actor, ...e }) => ({
    ...e,
    actor_name: nameOf(actor),
  }));
}

export async function getAbsenceTypes(includeInactive = false): Promise<AbsenceType[]> {
  const supabase = createClient();
  let q = supabase.from('absence_types').select('id, name, translations, sort_order, is_active').order('sort_order').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AbsenceType[];
}

/** Who approves absences. */
export async function getAbsenceApproverIds(): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('absence_approvers').select('profile_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.profile_id);
}
