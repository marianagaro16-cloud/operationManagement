import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { openersAndClosers, shiftCounts, weekDates, type Block, type ShiftCount } from '@/domain/schedule/schedule';
import type {
  ScheduleKind,
  SchedulePerson,
  ScheduleProduct,
  ScheduleSnapshot,
  ScheduleWeek,
  ScheduleWeekData,
  SundayDuty,
} from '@/types/schedule';

/*
 * The weekly work schedule's reads. RLS (schedule_can_read) returns them to
 * Admin, Owners and the Production manager, and to nobody else.
 */

const WEEK_COLUMNS = 'id, week_start, is_pattern, version, published_at, day_products, day_notes, holidays, cleaning_bathroom, cleaning_kitchen';
const BLOCK_COLUMNS = 'person_id, day, slot, start_time, end_time, kind_id';

const hm = (time: string | null) => (time ? time.slice(0, 5) : null);
const toBlock = (b: Block): Block => ({ ...b, start_time: hm(b.start_time), end_time: hm(b.end_time) });

export async function getScheduleKinds(includeInactive = false): Promise<ScheduleKind[]> {
  const supabase = createClient();
  let q = supabase.from('schedule_kinds').select('id, name, color, hatched, counts_hours, system_key, sort_order, is_active').order('sort_order').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data } = await q;
  return (data ?? []) as ScheduleKind[];
}

export async function getScheduleProducts(includeInactive = false): Promise<ScheduleProduct[]> {
  const supabase = createClient();
  let q = supabase.from('schedule_products').select('id, name, people_needed, sort_order, is_active').order('sort_order').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data } = await q;
  return ((data ?? []) as (Omit<ScheduleProduct, 'people_needed'> & { people_needed: number | string | null })[]).map((p) => ({
    ...p,
    people_needed: p.people_needed == null ? null : Number(p.people_needed),
  }));
}

type RawPerson = Omit<SchedulePerson, 'name' | 'profile_id' | 'min_hours' | 'max_hours'> & {
  min_hours: number | string | null;
  max_hours: number | string | null;
  worker: { name: string; profile_id: string | null } | null;
};

/** Everyone with a row on the schedule, in its order. */
export async function getSchedulePeople(includeInactive = false): Promise<SchedulePerson[]> {
  const supabase = createClient();
  let q = supabase
    .from('schedule_people')
    .select('id, worker_id, external_name, label, sort_order, percent, min_hours, max_hours, is_lead, in_sunday_rotation, sunday_order, in_cleaning_rotation, is_active, worker:hr_workers ( name, profile_id )')
    .order('sort_order')
    .order('created_at');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data } = await q;
  return ((data ?? []) as unknown as RawPerson[]).map(({ worker, ...p }) => ({
    ...p,
    min_hours: p.min_hours == null ? null : Number(p.min_hours),
    max_hours: p.max_hours == null ? null : Number(p.max_hours),
    profile_id: worker?.profile_id ?? null,
    // The label is what the schedule has always called them; a file the
    // viewer may not open (another team's) still has its label.
    name: p.label?.trim() || worker?.name || p.external_name || '—',
  }));
}

/** Every week there is, newest first: for moving between them and copying one. */
export async function getScheduleWeekList(): Promise<{ id: string; week_start: string; version: number }[]> {
  const supabase = createClient();
  const { data } = await supabase.from('schedule_weeks').select('id, week_start, version').eq('is_pattern', false).order('week_start', { ascending: false }).limit(400);
  return (data ?? []) as { id: string; week_start: string; version: number }[];
}

async function weekData(week: ScheduleWeek | null): Promise<ScheduleWeekData | null> {
  if (!week) return null;
  const supabase = createClient();
  const [{ data: blocks }, { data: versions }] = await Promise.all([
    supabase.from('schedule_blocks').select(BLOCK_COLUMNS).eq('week_id', week.id),
    supabase.from('schedule_week_versions').select('version, snapshot').eq('week_id', week.id).order('version', { ascending: false }).limit(2),
  ]);
  const snaps = (versions ?? []) as { version: number; snapshot: ScheduleSnapshot }[];
  return {
    week,
    blocks: ((blocks ?? []) as Block[]).map(toBlock),
    published: snaps[0]?.snapshot ?? null,
    previous: snaps[1]?.snapshot ?? null,
  };
}

/** The week starting on this Sunday, or null when it has not been made. */
export async function getScheduleWeek(weekStart: string): Promise<ScheduleWeekData | null> {
  const supabase = createClient();
  const { data } = await supabase.from('schedule_weeks').select(WEEK_COLUMNS).eq('week_start', weekStart).maybeSingle();
  return weekData(data as ScheduleWeek | null);
}

export async function getScheduleWeekById(id: string): Promise<ScheduleWeekData | null> {
  const supabase = createClient();
  const { data } = await supabase.from('schedule_weeks').select(WEEK_COLUMNS).eq('id', id).maybeSingle();
  return weekData(data as ScheduleWeek | null);
}

/** The usual week new ones can start from, if one was ever set up. */
export async function getSchedulePattern(): Promise<ScheduleWeekData | null> {
  const supabase = createClient();
  const { data } = await supabase.from('schedule_weeks').select(WEEK_COLUMNS).eq('is_pattern', true).maybeSingle();
  return weekData(data as ScheduleWeek | null);
}

/** One published version, as it was. */
export async function getScheduleVersion(weekId: string, version: number): Promise<ScheduleSnapshot | null> {
  const supabase = createClient();
  const { data } = await supabase.from('schedule_week_versions').select('snapshot').eq('week_id', weekId).eq('version', version).maybeSingle();
  return (data?.snapshot as ScheduleSnapshot | undefined) ?? null;
}

/**
 * Days of the week (0–6) on which a person has an approved absence, by
 * schedule person. Only people with an account can have one; RLS decides what
 * the viewer may read, and reading none simply shows no hint.
 */
export async function getScheduleAbsentDays(weekStart: string, people: SchedulePerson[]): Promise<Record<string, number[]>> {
  const byProfile = new Map(people.filter((p) => p.profile_id).map((p) => [p.profile_id as string, p.id]));
  if (byProfile.size === 0) return {};
  const dates = weekDates(weekStart);
  const supabase = createClient();
  const { data } = await supabase
    .from('absences')
    .select('profile_id, start_date, end_date')
    .eq('status', 'approved')
    .in('profile_id', [...byProfile.keys()])
    .lte('start_date', dates[6])
    .gte('end_date', dates[0]);
  const out: Record<string, number[]> = {};
  for (const a of (data ?? []) as { profile_id: string; start_date: string; end_date: string }[]) {
    const person = byProfile.get(a.profile_id);
    if (!person) continue;
    dates.forEach((d, day) => {
      if (d >= a.start_date && d <= a.end_date && !(out[person] ??= []).includes(day)) out[person].push(day);
    });
  }
  return out;
}

/**
 * How often each person opened and closed the day in the four weeks before
 * this one — for the planning view, so the rotation can be judged over more
 * than the week being made.
 */
export async function getShiftHistory(weekStart: string, kinds: ScheduleKind[]): Promise<Record<string, ShiftCount>> {
  const from = new Date(`${weekStart}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 28);
  const supabase = createClient();
  const { data: weeks } = await supabase
    .from('schedule_weeks')
    .select('id')
    .eq('is_pattern', false)
    .gte('week_start', from.toISOString().slice(0, 10))
    .lt('week_start', weekStart);
  const ids = (weeks ?? []).map((w) => w.id as string);
  if (ids.length === 0) return {};
  const { data } = await supabase.from('schedule_blocks').select(`week_id, ${BLOCK_COLUMNS}`).in('week_id', ids);
  const rules = new Map(kinds.map((k) => [k.id, { id: k.id, counts_hours: k.counts_hours }]));
  const all = (data ?? []) as unknown as (Block & { week_id: string })[];
  return shiftCounts(ids.map((id) => openersAndClosers(all.filter((b) => b.week_id === id).map(toBlock), rules)));
}

/** The Sunday and holiday register, oldest first. */
export async function getSundayDuties(): Promise<SundayDuty[]> {
  const supabase = createClient();
  const { data } = await supabase.from('schedule_sunday_duty').select('id, duty_date, person_id, person_name, note, origin').order('duty_date').order('created_at').limit(2000);
  return (data ?? []) as SundayDuty[];
}
