'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { blockHours, changedCells, weekDates, weekStartOf, type Block, type KindRule } from '@/domain/schedule/schedule';
import type { ActionResult } from './actions';
import type { ScheduleSnapshot, ScheduleWeek } from '@/types/schedule';

/*
 * The weekly work schedule's writes — Admin and Owners only (RLS: is_admin).
 * A write refused by RLS changes no row, which is how it is told apart here.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const uuid = z.string().uuid();
const WEEK_COLUMNS = 'id, week_start, is_pattern, version, published_at, day_products, day_notes, holidays, cleaning_bathroom, cleaning_kitchen';
const BLOCK_COLUMNS = 'person_id, day, slot, start_time, end_time, kind_id';

function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  if (error.message.includes('schedule_weeks_week_start_key')) return { ok: false, error: 'week_exists' };
  if (error.message.includes('violates foreign key')) return { ok: false, error: 'in_use' };
  return { ok: false, error: error.message };
}
const done = (): ActionResult => ({ ok: true, data: undefined });
function revalidate() {
  revalidatePath('/schedule');
  revalidatePath('/admin/schedule');
}
const hm = (time: string | null) => (time ? time.slice(0, 5) : null);

async function me(): Promise<string | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function blocksOf(weekId: string): Promise<Block[]> {
  const supabase = createClient();
  const { data } = await supabase.from('schedule_blocks').select(BLOCK_COLUMNS).eq('week_id', weekId);
  return ((data ?? []) as Block[]).map((b) => ({ ...b, start_time: hm(b.start_time), end_time: hm(b.end_time) }));
}

/* --------------------------------- weeks --------------------------------- */

/**
 * Start a week: empty, from the usual week, or as a copy of another one.
 * A copy brings the hours and the products of each day; days off, notes and
 * the cleaning are that week's own and are left behind.
 */
export async function createScheduleWeek(input: { date: string; source: 'empty' | 'pattern' | string }): Promise<ActionResult<{ week_start: string }>> {
  if (!DATE.safeParse(input.date).success) return { ok: false, error: 'invalid_date' };
  const weekStart = weekStartOf(input.date);
  const supabase = createClient();

  let from: (Pick<ScheduleWeek, 'id' | 'day_products'>) | null = null;
  if (input.source !== 'empty') {
    const q = supabase.from('schedule_weeks').select('id, day_products');
    const { data } = await (input.source === 'pattern' ? q.eq('is_pattern', true) : q.eq('id', input.source)).maybeSingle();
    if (!data) return { ok: false, error: input.source === 'pattern' ? 'no_pattern' : 'not_found' };
    from = data as Pick<ScheduleWeek, 'id' | 'day_products'>;
  }

  const { data: week, error } = await supabase
    .from('schedule_weeks')
    .insert({ week_start: weekStart, day_products: from?.day_products ?? {}, created_by: await me() })
    .select('id')
    .single();
  if (error) return fail(error);

  if (from) {
    const [source, { data: kinds }, { data: people }] = await Promise.all([
      blocksOf(from.id),
      supabase.from('schedule_kinds').select('id, counts_hours'),
      supabase.from('schedule_people').select('id').eq('is_active', true),
    ]);
    const off = new Set(((kinds ?? []) as KindRule[]).filter((k) => !k.counts_hours).map((k) => k.id));
    const active = new Set(((people ?? []) as { id: string }[]).map((p) => p.id));
    const rows = source
      .filter((b) => active.has(b.person_id) && !(b.kind_id && off.has(b.kind_id)))
      .map((b) => ({ ...b, week_id: (week as { id: string }).id }));
    if (rows.length > 0) {
      const { error: copyError } = await supabase.from('schedule_blocks').insert(rows);
      if (copyError) return fail(copyError);
    }
  }
  revalidate();
  return { ok: true, data: { week_start: weekStart } };
}

/** The usual week, made the first time it is opened. */
export async function ensureSchedulePattern(): Promise<ActionResult> {
  const supabase = createClient();
  const { data } = await supabase.from('schedule_weeks').select('id').eq('is_pattern', true).maybeSingle();
  if (data) return done();
  const { error } = await supabase.from('schedule_weeks').insert({ is_pattern: true, created_by: await me() });
  if (error) return fail(error);
  revalidate();
  return done();
}

/** A draft made by mistake. A published week is a record and stays. */
export async function deleteScheduleWeek(weekId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('schedule_weeks').delete().eq('id', weekId).eq('version', 0).eq('is_pattern', false).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'week_published' };
  revalidate();
  return done();
}

const cellSchema = z
  .array(
    z.object({
      slot: z.union([z.literal(1), z.literal(2)]),
      start_time: TIME.nullable(),
      end_time: TIME.nullable(),
      kind_id: uuid.nullable(),
    }),
  )
  .max(2);

/** A person's day: its one or two blocks, replaced as a whole. */
export async function saveScheduleCell(weekId: string, personId: string, day: number, input: z.input<typeof cellSchema>): Promise<ActionResult> {
  const parsed = cellSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(weekId).success || !uuid.safeParse(personId).success || !Number.isInteger(day) || day < 0 || day > 6) {
    return { ok: false, error: 'invalid_block' };
  }
  const blocks = parsed.data;
  if (new Set(blocks.map((b) => b.slot)).size !== blocks.length) return { ok: false, error: 'invalid_block' };
  for (const b of blocks) {
    if ((b.start_time === null) !== (b.end_time === null)) return { ok: false, error: 'times_both' };
    if (b.start_time && b.end_time && b.end_time <= b.start_time) return { ok: false, error: 'times_order' };
    // Production is hours; only a kind can stand for a whole day.
    if (!b.kind_id && !b.start_time) return { ok: false, error: 'times_required' };
  }

  const supabase = createClient();
  const { data: gone, error: removeError } = await supabase.from('schedule_blocks').delete().eq('week_id', weekId).eq('person_id', personId).eq('day', day).select('id');
  if (removeError) return fail(removeError);
  if (blocks.length > 0) {
    const { error } = await supabase.from('schedule_blocks').insert(blocks.map((b) => ({ ...b, week_id: weekId, person_id: personId, day })));
    if (error) return fail(error);
  } else if (!gone?.length) {
    // Nothing removed and nothing to add: either it was already empty, or RLS refused. Ask which.
    const { data: week } = await supabase.from('schedule_weeks').select('id').eq('id', weekId).maybeSingle();
    if (!week) return { ok: false, error: 'not_authorized' };
  }
  revalidate();
  return done();
}

const headerSchema = z.object({
  day_products: z.record(z.string().regex(/^[0-6]$/), z.array(uuid).max(10)).optional(),
  day_notes: z.record(z.string().regex(/^[0-6]$/), z.string().trim().max(300)).optional(),
  holidays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  cleaning_bathroom: uuid.nullable().optional(),
  cleaning_kitchen: uuid.nullable().optional(),
});

/** What is produced, the notes and holidays of the days, and the weekly cleaning. */
export async function saveScheduleHeader(weekId: string, input: z.input<typeof headerSchema>): Promise<ActionResult> {
  const parsed = headerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_week' };
  const patch = { ...parsed.data };
  if (patch.day_notes) patch.day_notes = Object.fromEntries(Object.entries(patch.day_notes).filter(([, v]) => v));
  if (patch.day_products) patch.day_products = Object.fromEntries(Object.entries(patch.day_products).filter(([, v]) => v.length > 0));
  if (patch.holidays) patch.holidays = [...new Set(patch.holidays)].sort();
  const supabase = createClient();
  const { data, error } = await supabase.from('schedule_weeks').update(patch).eq('id', weekId).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate();
  return done();
}

const headerText = (s: Pick<ScheduleSnapshot, 'day_products' | 'day_notes' | 'holidays' | 'cleaning_bathroom' | 'cleaning_kitchen'>) =>
  JSON.stringify([
    Object.entries(s.day_products ?? {}).sort(),
    Object.entries(s.day_notes ?? {}).sort(),
    [...(s.holidays ?? [])].sort(),
    s.cleaning_bathroom,
    s.cleaning_kitchen,
  ]);

/**
 * Publish: version 1 the first time, the next one after a change. What the
 * week holds at that moment is kept, so every version can be read again and
 * the next one can show what changed against it.
 *
 * Also carries who works that Sunday, or a holiday of the week, to the
 * register: the people on the schedule replace whoever was only planned.
 */
export async function publishScheduleWeek(weekId: string): Promise<ActionResult<{ version: number }>> {
  const supabase = createClient();
  const { data: row } = await supabase.from('schedule_weeks').select(WEEK_COLUMNS).eq('id', weekId).maybeSingle();
  const week = row as ScheduleWeek | null;
  if (!week || week.is_pattern || !week.week_start) return { ok: false, error: 'not_found' };

  const blocks = await blocksOf(weekId);
  const snapshot: ScheduleSnapshot = {
    blocks,
    day_products: week.day_products ?? {},
    day_notes: week.day_notes ?? {},
    holidays: week.holidays ?? [],
    cleaning_bathroom: week.cleaning_bathroom,
    cleaning_kitchen: week.cleaning_kitchen,
  };
  if (week.version === 0 && blocks.length === 0) return { ok: false, error: 'week_empty' };
  if (week.version > 0) {
    const { data: last } = await supabase.from('schedule_week_versions').select('snapshot').eq('week_id', weekId).eq('version', week.version).maybeSingle();
    const before = last?.snapshot as ScheduleSnapshot | undefined;
    if (before && changedCells(before.blocks, blocks).size === 0 && headerText(before) === headerText(snapshot)) return { ok: false, error: 'nothing_changed' };
  }

  const version = week.version + 1;
  const uid = await me();
  const { error: versionError } = await supabase.from('schedule_week_versions').insert({ week_id: weekId, version, snapshot, published_by: uid });
  if (versionError) return fail(versionError);
  const { data: updated, error } = await supabase
    .from('schedule_weeks')
    .update({ version, published_at: new Date().toISOString(), published_by: uid })
    .eq('id', weekId)
    .select('id');
  if (error) return fail(error);
  if (!updated?.length) return { ok: false, error: 'not_authorized' };

  await syncSundayDuty(week.week_start, snapshot, uid);
  revalidate();
  return { ok: true, data: { version } };
}

async function syncSundayDuty(weekStart: string, snapshot: ScheduleSnapshot, uid: string | null) {
  const supabase = createClient();
  const [{ data: kinds }, { data: people }] = await Promise.all([
    supabase.from('schedule_kinds').select('id, counts_hours'),
    supabase.from('schedule_people').select('id, label, external_name, worker:hr_workers ( name )'),
  ]);
  const rules = new Map(((kinds ?? []) as KindRule[]).map((k) => [k.id, k]));
  const names = new Map(
    ((people ?? []) as unknown as { id: string; label: string | null; external_name: string | null; worker: { name: string } | null }[]).map((p) => [
      p.id,
      p.label?.trim() || p.worker?.name || p.external_name || '—',
    ]),
  );
  const dates = weekDates(weekStart);

  for (const day of [...new Set([0, ...snapshot.holidays])]) {
    const date = dates[day];
    const working = [...new Set(snapshot.blocks.filter((b) => b.day === day && blockHours(b, rules) > 0).map((b) => b.person_id))];
    const { data: existing } = await supabase.from('schedule_sunday_duty').select('id, person_id, person_name, origin').eq('duty_date', date);
    const rows = (existing ?? []) as { id: string; person_id: string | null; person_name: string; origin: string }[];

    // Nobody on the schedule that day: only what an earlier version put there goes.
    const stale = rows.filter((r) => (working.length === 0 ? r.origin === 'schedule' : !r.person_id || !working.includes(r.person_id)));
    if (stale.length > 0) await supabase.from('schedule_sunday_duty').delete().in('id', stale.map((r) => r.id));
    const planned = stale.filter((r) => r.origin !== 'schedule').map((r) => r.person_name);
    const missing = working.filter((id) => !rows.some((r) => r.person_id === id));
    if (missing.length > 0) {
      await supabase.from('schedule_sunday_duty').insert(
        missing.map((id) => ({
          duty_date: date,
          person_id: id,
          person_name: names.get(id) ?? '—',
          origin: 'schedule',
          // A swap leaves its trace: who had been planned.
          note: planned.length > 0 ? `Cambio: estaba previsto ${planned.join(', ')}` : null,
          created_by: uid,
        })),
      );
    }
  }
}

/* --------------------------- Sundays and holidays --------------------------- */

const dutySchema = z.object({
  duty_date: DATE,
  person_id: uuid.nullable(),
  person_name: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/** Plan a Sunday or a holiday ahead, or write down one that is not on a schedule. */
export async function saveSundayDuty(input: z.input<typeof dutySchema>): Promise<ActionResult> {
  const parsed = dutySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_duty' };
  const v = parsed.data;
  const supabase = createClient();
  let name = v.person_name ?? '';
  if (v.person_id) {
    const { data } = await supabase.from('schedule_people').select('label, external_name, worker:hr_workers ( name )').eq('id', v.person_id).maybeSingle();
    const p = data as unknown as { label: string | null; external_name: string | null; worker: { name: string } | null } | null;
    name = p?.label?.trim() || p?.worker?.name || p?.external_name || name;
  }
  if (!name) return { ok: false, error: 'name_required' };
  const { error } = await supabase
    .from('schedule_sunday_duty')
    .insert({ duty_date: v.duty_date, person_id: v.person_id, person_name: name, note: v.note || null, origin: 'planned', created_by: await me() });
  if (error) return fail(error);
  revalidate();
  return done();
}

export async function deleteSundayDuty(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('schedule_sunday_duty').delete().eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidate();
  return done();
}

/* ------------------------------- the lists ------------------------------- */

const hours = z.number().min(0).max(100).nullable();
const personSchema = z
  .object({
    worker_id: uuid.nullable().optional(),
    external_name: z.string().trim().max(80).nullable().optional(),
    label: z.string().trim().max(40).nullable().transform((v) => v || null),
    sort_order: z.number().int(),
    percent: z.number().int().min(1).max(100).nullable(),
    min_hours: hours,
    max_hours: hours,
    is_lead: z.boolean(),
    in_sunday_rotation: z.boolean(),
    sunday_order: z.number().int(),
    is_active: z.boolean(),
  })
  .refine((p) => p.min_hours == null || p.max_hours == null || p.max_hours >= p.min_hours, { message: 'hours_order' });

/** A row of the schedule: a worker file or external help, and what the week checks for them. */
export async function saveSchedulePerson(input: z.input<typeof personSchema>, id?: string): Promise<ActionResult> {
  const parsed = personSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message === 'hours_order' ? 'hours_order' : 'invalid_person' };
  const { worker_id, external_name, ...rest } = parsed.data;
  const supabase = createClient();
  if (id) {
    // Who the row is does not change; an external's name can be corrected.
    const { data, error } = await supabase.from('schedule_people').update({ ...rest, ...(external_name ? { external_name } : {}) }).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return { ok: false, error: 'not_authorized' };
  } else {
    if (!worker_id === !external_name) return { ok: false, error: 'invalid_person' };
    const { error } = await supabase.from('schedule_people').insert({ ...rest, worker_id: worker_id ?? null, external_name: worker_id ? null : external_name });
    if (error) return error.message.includes('schedule_people_worker_id_key') ? { ok: false, error: 'person_exists' } : fail(error);
  }
  revalidate();
  return done();
}

const kindSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  hatched: z.boolean(),
  counts_hours: z.boolean(),
  sort_order: z.number().int(),
  is_active: z.boolean(),
});

export async function saveScheduleKind(input: z.input<typeof kindSchema>, id?: string): Promise<ActionResult> {
  const parsed = kindSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_kind' };
  const supabase = createClient();
  if (id) {
    const { data: current } = await supabase.from('schedule_kinds').select('system_key').eq('id', id).maybeSingle();
    if (!current) return { ok: false, error: 'not_authorized' };
    // Vacaciones, Libre and Enfermedad stay days off and stay in the list.
    const patch = current.system_key ? { ...parsed.data, counts_hours: false, is_active: true } : parsed.data;
    const { data, error } = await supabase.from('schedule_kinds').update(patch).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return { ok: false, error: 'not_authorized' };
  } else {
    const { error } = await supabase.from('schedule_kinds').insert(parsed.data);
    if (error) return fail(error);
  }
  revalidate();
  return done();
}

const productSchema = z.object({ name: z.string().trim().min(1).max(60), sort_order: z.number().int(), is_active: z.boolean() });

export async function saveScheduleProduct(input: z.input<typeof productSchema>, id?: string): Promise<ActionResult> {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_product' };
  const supabase = createClient();
  if (id) {
    const { data, error } = await supabase.from('schedule_products').update(parsed.data).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return { ok: false, error: 'not_authorized' };
  } else {
    const { error } = await supabase.from('schedule_products').insert(parsed.data);
    if (error) return fail(error);
  }
  revalidate();
  return done();
}

/* ------------------------------- arrivals ------------------------------- */

/** When the person was due that day, by the published schedule: 'HH:MM' or null. */
export async function scheduledStart(workerId: string, date: string): Promise<string | null> {
  if (!uuid.safeParse(workerId).success || !DATE.safeParse(date).success) return null;
  const supabase = createClient();
  const { data } = await supabase.rpc('schedule_start_time', { p_worker_id: workerId, p_date: date });
  return typeof data === 'string' ? data.slice(0, 5) : null;
}
