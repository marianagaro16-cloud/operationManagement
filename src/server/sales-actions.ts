'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { OPEN_STAGES } from '@/types/sales';
import { geocodeAddress } from './geocode';
import { sendToUser } from './push';
import { DateTime } from 'luxon';
import { BUSINESS_TZ } from '@/lib/datetime';
import type { ActionResult } from './actions';

/*
 * Sales writes. Who is sales is the database's decision (is_sales() in the
 * RLS). Notes are only ever added. What comes next — a call back, a visit —
 * is a planned activity, the same thing the Planning tab shows.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'invalid_time' });
const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

const KNOWN = [
  'not_authorized', 'prospect_closed', 'owner_not_sales', 'use_win_or_lose', 'lost_reason_required',
  'prospect_not_found', 'salesperson_not_sales', 'activity_recorded', 'kind_behavior_fixed',
  'sales_activities_one_target', 'sales_activities_free_has_title', 'sales_activities_end_after_start',
  'participant_not_sales', 'participant_is_organiser',
];

function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: KNOWN.find((code) => error.message.includes(code)) ?? error.message };
}

function revalidateSales(...paths: string[]) {
  revalidatePath('/sales');
  revalidatePath('/dashboard');
  for (const p of paths) revalidatePath(p);
}

/* ------------------------------- planning ------------------------------- */

/** A planned activity as the forms send it. */
const planFields = z.object({
    kind_id: z.string().uuid({ message: 'kind_required' }),
    activity_date: DATE,
    activity_time: TIME.nullable().optional().transform((v) => v ?? null),
    activity_end: TIME.nullable().optional().transform((v) => v ?? null),
    title: text(300),
    place: z.enum(['theirs', 'office', 'online', 'other']).nullable().optional().transform((v) => v ?? null),
    place_detail: text(500),
});

// Until a time only after the start, and only with one.
const endAfterStart = (p: { activity_time: string | null; activity_end: string | null }) =>
  !p.activity_end || (!!p.activity_time && p.activity_end.slice(0, 5) > p.activity_time.slice(0, 5));

const planSchema = planFields.refine(endAfterStart, { message: 'end_before_start' });

export type PlanInput = z.input<typeof planSchema>;

const activitySchema = planFields.extend({
  salesperson_id: z.string().uuid(),
  customer_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  prospect_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  follows_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
}).refine(endAfterStart, { message: 'end_before_start' });

/** Plan an activity: at the end of the day's route when it is a visit. */
async function insertActivity(input: z.output<typeof activitySchema>): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: last } = await supabase
    .from('sales_activities')
    .select('position')
    .eq('salesperson_id', input.salesperson_id)
    .eq('activity_date', input.activity_date)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from('sales_activities')
    .insert({ ...input, position: (last?.position ?? 0) + 1, created_by: user?.id ?? null })
    .select('id')
    .single();
  if (error) return fail(error);
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/* ------------------------------ participants ----------------------------- */

const participantsSchema = z.array(z.string().uuid()).max(10);

/** What a participant's notification says: kind · with whom — day, time (organiser). */
async function describeActivity(id: string): Promise<{ date: string; text: string } | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('sales_activities')
    .select(
      'activity_date, activity_time, title, kind:sales_activity_kinds ( name ), customer:customers ( company_name ), prospect:prospects ( company_name ), organiser:profiles!sales_activities_salesperson_id_fkey ( name, email )',
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const a = data as unknown as {
    activity_date: string;
    activity_time: string | null;
    title: string | null;
    kind: { name: string } | null;
    customer: { company_name: string } | null;
    prospect: { company_name: string } | null;
    organiser: { name: string | null; email: string } | null;
  };
  const who = a.customer?.company_name ?? a.prospect?.company_name ?? a.title ?? '';
  // Written in Spanish, like every other server-sent notification.
  const day = DateTime.fromISO(a.activity_date, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.');
  const time = a.activity_time ? ` ${a.activity_time.slice(0, 5)}` : '';
  const organiser = a.organiser ? a.organiser.name || a.organiser.email : '';
  return {
    date: a.activity_date,
    text: `${a.kind?.name ?? ''}${who ? ` · ${who}` : ''} — ${day}${time}${organiser ? ` (${organiser})` : ''}`,
  };
}

async function tell(people: string[], about: { date: string; text: string } | null, title: string, tag: string) {
  if (!about) return;
  for (const id of people) {
    try {
      await sendToUser(id, { title, body: about.text, url: `/sales?tab=planning&date=${about.date}&person=${id}`, tag: `${tag}-${id}` });
    } catch (err) {
      console.error('participant notice failed', err);
    }
  }
}

/**
 * Who else takes part: the ones added are told, the ones taken off too.
 * Returns who was there before and stays, for "moved" notices.
 */
async function setParticipants(
  activityId: string,
  organiserId: string,
  wanted: string[],
): Promise<{ ok: true; kept: string[] } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const target = [...new Set(wanted)].filter((id) => id !== organiserId);
  const { data: current } = await supabase.from('sales_activity_participants').select('profile_id').eq('activity_id', activityId);
  const before = (current ?? []).map((r) => r.profile_id);
  const added = target.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !target.includes(id));
  if (removed.length) {
    const { error } = await supabase.from('sales_activity_participants').delete().eq('activity_id', activityId).in('profile_id', removed);
    if (error) return fail(error);
  }
  if (added.length) {
    const { error } = await supabase
      .from('sales_activity_participants')
      .insert(added.map((profile_id) => ({ activity_id: activityId, profile_id, added_by: user?.id ?? null })));
    if (error) return fail(error);
  }
  if (added.length || removed.length) {
    const about = await describeActivity(activityId);
    await tell(added, about, 'Te incluyeron en una actividad', `sales-with-${activityId}`);
    await tell(removed, about, 'Ya no participas en una actividad', `sales-with-${activityId}`);
  }
  return { ok: true, kept: before.filter((id) => target.includes(id)) };
}

/** Take yourself off an activity you were added to. */
export async function leaveActivity(activityId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };
  const { error } = await supabase.from('sales_activity_participants').delete().eq('activity_id', activityId).eq('profile_id', user.id);
  if (error) return fail(error);
  revalidateSales();
  return { ok: true, data: undefined };
}

export async function planActivity(
  input: z.input<typeof activitySchema>,
  participants: string[] = [],
): Promise<ActionResult<{ id: string }>> {
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_activity' };
  const people = participantsSchema.safeParse(participants);
  if (!people.success) return { ok: false, error: 'invalid_activity' };
  const res = await insertActivity(parsed.data);
  if (res.ok && people.data.length) {
    const set = await setParticipants(res.data.id, parsed.data.salesperson_id, people.data);
    if (!set.ok) return set;
  }
  if (res.ok) {
    revalidateSales(
      parsed.data.customer_id ? `/sales/customers/${parsed.data.customer_id}` : '',
      parsed.data.prospect_id ? `/sales/prospects/${parsed.data.prospect_id}` : '',
    );
  }
  return res;
}

/**
 * Move a planned activity to another day or time, or change what it says —
 * and, when given, who else takes part. Those who stay are told if it moved.
 * The organiser and managers only (RLS).
 */
export async function updateActivity(id: string, input: PlanInput, participants?: string[]): Promise<ActionResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_activity' };
  const people = participants === undefined ? null : participantsSchema.safeParse(participants);
  if (people && !people.success) return { ok: false, error: 'invalid_activity' };
  const supabase = createClient();
  const { data: before } = await supabase
    .from('sales_activities')
    .select('salesperson_id, activity_date, activity_time')
    .eq('id', id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'not_authorized' };
  const { data, error } = await supabase.from('sales_activities').update(parsed.data).eq('id', id).eq('status', 'planned').select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };

  let kept: string[];
  if (people?.success) {
    const set = await setParticipants(id, before.salesperson_id, people.data);
    if (!set.ok) return set;
    kept = set.kept;
  } else {
    const { data: rows } = await supabase.from('sales_activity_participants').select('profile_id').eq('activity_id', id);
    kept = (rows ?? []).map((r) => r.profile_id);
  }
  const moved =
    before.activity_date !== parsed.data.activity_date ||
    (before.activity_time ?? '').slice(0, 5) !== (parsed.data.activity_time ?? '').slice(0, 5);
  if (moved && kept.length) await tell(kept, await describeActivity(id), 'Actividad cambiada de fecha u hora', `sales-with-${id}`);

  revalidateSales();
  return { ok: true, data: undefined };
}

/** Off the plan — only while it has no result. Whoever took part is told. */
export async function removeActivity(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const [about, { data: rows }] = await Promise.all([
    describeActivity(id),
    supabase.from('sales_activity_participants').select('profile_id').eq('activity_id', id),
  ]);
  const { data, error } = await supabase.from('sales_activities').delete().eq('id', id).eq('status', 'planned').select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'activity_recorded' };
  await tell((rows ?? []).map((r) => r.profile_id), about, 'Actividad quitada', `sales-with-${id}`);
  revalidateSales();
  return { ok: true, data: undefined };
}

/** Write the route order of a day's visits, 1..n. */
export async function setRouteOrder(ids: string[]): Promise<ActionResult> {
  const valid = z.array(z.string().uuid()).max(100).safeParse(ids);
  if (!valid.success) return { ok: false, error: 'invalid_activity' };
  const supabase = createClient();
  for (const [index, id] of valid.data.entries()) {
    const { error } = await supabase.from('sales_activities').update({ position: index + 1 }).eq('id', id);
    if (error) return fail(error);
  }
  revalidateSales();
  return { ok: true, data: undefined };
}

const resultSchema = z.object({
  activity_id: z.string().uuid(),
  status: z.enum(['done', 'not_done']),
  note: text(5000),
  /** Plan what comes next, right here. */
  next: planSchema.nullable().optional().transform((v) => v ?? null),
});

/**
 * After an activity: done or not done; what happened becomes a note of the
 * same kind on the customer or prospect; and what comes next is planned
 * with the same person.
 */
export async function recordActivity(input: z.input<typeof resultSchema>): Promise<ActionResult<{ next: 'none' | 'planned' | 'failed' }>> {
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_activity' };
  const v = parsed.data;
  const supabase = createClient();

  const { data: activity, error: readError } = await supabase
    .from('sales_activities')
    .select('salesperson_id, kind_id, activity_date, status, customer_id, prospect_id')
    .eq('id', v.activity_id)
    .maybeSingle();
  if (readError) return fail(readError);
  if (!activity) return { ok: false, error: 'not_authorized' };
  if (activity.status !== 'planned') return { ok: false, error: 'activity_recorded' };

  // The organiser records it, or a manager (RLS); a participant cannot.
  const { data: recorded, error } = await supabase
    .from('sales_activities')
    .update({ status: v.status, done_at: new Date().toISOString() })
    .eq('id', v.activity_id)
    .select('id');
  if (error) return fail(error);
  if (!recorded?.length) return { ok: false, error: 'not_authorized' };

  const { data: { user } } = await supabase.auth.getUser();
  if (v.note && (activity.customer_id || activity.prospect_id)) {
    const note = { kind_id: activity.kind_id, note_date: activity.activity_date, body: v.note, created_by: user?.id ?? null };
    const { error: noteError } = activity.customer_id
      ? await supabase.from('customer_notes').insert({ ...note, customer_id: activity.customer_id })
      : await supabase.from('prospect_notes').insert({ ...note, prospect_id: activity.prospect_id! });
    if (noteError) return fail(noteError);
  }

  let next: 'none' | 'planned' | 'failed' = 'none';
  if (v.next) {
    // The note and the result stand either way; a failed plan is reported, not undone.
    const res = await insertActivity({
      ...v.next,
      salesperson_id: activity.salesperson_id,
      customer_id: activity.customer_id,
      prospect_id: activity.prospect_id,
      follows_id: v.activity_id,
    });
    next = res.ok ? 'planned' : 'failed';
  }

  revalidateSales(
    activity.customer_id ? `/sales/customers/${activity.customer_id}` : '',
    activity.prospect_id ? `/sales/prospects/${activity.prospect_id}` : '',
  );
  return { ok: true, data: { next } };
}

/* --------------------------------- notes --------------------------------- */

const noteSchema = z.object({
  target: z.enum(['customer', 'prospect']),
  target_id: z.string().uuid(),
  kind_id: z.string().uuid({ message: 'kind_required' }),
  note_date: DATE,
  body: z.string().trim().min(1, { message: 'body_required' }).max(5000),
  /** Plan what comes next with them, and who does it. */
  next: planSchema.nullable().optional().transform((v) => v ?? null),
});

/** A note on a customer or a prospect; optionally, the next activity planned with them. */
export async function addNote(input: z.input<typeof noteSchema>): Promise<ActionResult<{ next: 'none' | 'planned' | 'failed' }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_note' };
  const v = parsed.data;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const note = { kind_id: v.kind_id, note_date: v.note_date, body: v.body, created_by: user.id };
  const { error } = v.target === 'customer'
    ? await supabase.from('customer_notes').insert({ ...note, customer_id: v.target_id })
    : await supabase.from('prospect_notes').insert({ ...note, prospect_id: v.target_id });
  if (error) return fail(error);

  let next: 'none' | 'planned' | 'failed' = 'none';
  if (v.next) {
    // A prospect's activities are its responsible salesperson's; a customer's, whoever writes.
    let salesperson = user.id;
    if (v.target === 'prospect') {
      const { data: prospect } = await supabase.from('prospects').select('owner_id').eq('id', v.target_id).maybeSingle();
      salesperson = prospect?.owner_id ?? user.id;
    }
    const res = await insertActivity({
      ...v.next,
      salesperson_id: salesperson,
      customer_id: v.target === 'customer' ? v.target_id : null,
      prospect_id: v.target === 'prospect' ? v.target_id : null,
      follows_id: null,
    });
    next = res.ok ? 'planned' : 'failed';
  }

  revalidateSales(v.target === 'customer' ? `/sales/customers/${v.target_id}` : `/sales/prospects/${v.target_id}`);
  return { ok: true, data: { next } };
}

/* ------------------------------- prospects ------------------------------- */

const prospectSchema = z.object({
  company_name: z.string().trim().min(1, { message: 'name_required' }).max(200),
  contact_name: text(200),
  phone: text(60),
  email: text(200),
  street: text(200),
  postal_code: text(20),
  city: text(100),
  customer_type_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  source_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  interest: text(2000),
  weekly_volume: text(200),
  stage: z.enum(OPEN_STAGES),
  owner_id: z.string().uuid({ message: 'owner_required' }),
});

export type ProspectInput = z.input<typeof prospectSchema>;

/**
 * Create a prospect — with its first planned activity, since every open
 * prospect has something planned — or change an open one. Won and lost have
 * their own actions.
 */
export async function saveProspect(
  input: ProspectInput,
  id?: string,
  first?: PlanInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = prospectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_prospect' };
  const firstPlan = id ? null : planSchema.safeParse(first);
  if (firstPlan && !firstPlan.success) return { ok: false, error: 'first_activity_required' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Placed on the map when the address is new or changed, and only then — so
  // a prospect can be on a visit route. A geocoder outage leaves it unplaced,
  // never unsaved.
  const address = { street: parsed.data.street, postal_code: parsed.data.postal_code, city: parsed.data.city };
  let placed: { latitude: number | null; longitude: number | null } | undefined;
  const before = id
    ? (await supabase.from('prospects').select('street, postal_code, city').eq('id', id).maybeSingle()).data
    : null;
  const changed = !before
    || before.street !== address.street || before.postal_code !== address.postal_code || before.city !== address.city;
  if (changed) {
    const coordinates = await geocodeAddress(address);
    placed = { latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null };
  }
  const row = { ...parsed.data, ...(placed ?? {}) };

  const query = id
    ? supabase.from('prospects').update(row).eq('id', id).select('id').single()
    : supabase.from('prospects').insert({ ...row, created_by: user?.id ?? null }).select('id').single();
  const { data, error } = await query;
  if (error) return fail(error);
  const saved = (data as { id: string }).id;

  if (firstPlan?.success) {
    const res = await insertActivity({
      ...firstPlan.data,
      salesperson_id: parsed.data.owner_id,
      prospect_id: saved,
      customer_id: null,
      follows_id: null,
    });
    if (!res.ok) return res;
  }

  revalidateSales(`/sales/prospects/${saved}`);
  return { ok: true, data: { id: saved } };
}

/** Won: the customer is created, the notes go to its file, and what was planned stays planned with it. */
export async function winProspect(id: string): Promise<ActionResult<{ customerId: string }>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('sales_prospect_win', { p_prospect_id: id });
  if (error) return fail(error);
  revalidateSales(`/sales/prospects/${id}`);
  return { ok: true, data: { customerId: data as string } };
}

/** Lost: with a reason; nothing stays planned with them. */
export async function loseProspect(id: string, reasonId: string, note: string | null): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(reasonId).success) return { ok: false, error: 'lost_reason_required' };
  const supabase = createClient();
  const { error } = await supabase.rpc('sales_prospect_lose', { p_prospect_id: id, p_reason_id: reasonId, p_note: note ?? '' });
  if (error) return fail(error);
  revalidateSales(`/sales/prospects/${id}`);
  return { ok: true, data: undefined };
}

/* ----------------------------- Admin's lists ----------------------------- */

const listEntrySchema = z.object({
  name: z.string().trim().min(1, { message: 'name_required' }).max(100),
  translations: z
    .object({
      de: z.object({ name: z.string().trim().max(100).nullable().optional() }).optional(),
      en: z.object({ name: z.string().trim().max(100).nullable().optional() }).optional(),
    })
    .default({}),
  sort_order: z.number().int().default(100),
  is_active: z.boolean().default(true),
});

export type ProspectListInput = z.input<typeof listEntrySchema>;

/** How we found a prospect, or why one was lost (RLS: is_admin). */
export async function saveProspectListEntry(
  list: 'sources' | 'lost_reasons',
  input: ProspectListInput,
  id?: string,
): Promise<ActionResult> {
  const parsed = listEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_entry' };
  const table = list === 'sources' ? 'prospect_sources' : 'prospect_lost_reasons';
  const supabase = createClient();
  const { error } = id
    ? await supabase.from(table).update(parsed.data).eq('id', id)
    : await supabase.from(table).insert({ ...parsed.data, slug: crypto.randomUUID() });
  if (error) return fail(error);
  revalidatePath('/admin/sales');
  revalidatePath('/sales', 'layout');
  return { ok: true, data: undefined };
}

const kindSchema = listEntrySchema.extend({
  icon: z.enum(['phone', 'calendar', 'mail', 'map-pin', 'message-circle', 'tag', 'star', 'file-text', 'circle']),
  default_minutes: z.number().int().min(5).max(600).default(30),
});

/**
 * A kind of activity (RLS: is_admin). Kinds Admin adds are plain; Visit and
 * Appointment can be renamed but not switched off (the database says so).
 */
export async function saveActivityKind(input: z.input<typeof kindSchema>, id?: string): Promise<ActionResult> {
  const parsed = kindSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_entry' };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('sales_activity_kinds').update(parsed.data).eq('id', id)
    : await supabase.from('sales_activity_kinds').insert({ ...parsed.data, slug: crypto.randomUUID(), behavior: 'plain' });
  if (error) return fail(error);
  revalidatePath('/admin/sales');
  revalidatePath('/sales', 'layout');
  return { ok: true, data: undefined };
}

/* ------------------------------ the route ------------------------------ */

const startSchema = z.object({
  user_id: z.string().uuid(),
  street: text(200),
  postal_code: text(20),
  city: text(100),
});

/** A salesperson's home address; placed on the map on save. */
export async function saveStartPoint(input: z.input<typeof startSchema>): Promise<ActionResult<{ placed: boolean }>> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_address' };
  const coordinates = await geocodeAddress(parsed.data);
  const supabase = createClient();
  const { error } = await supabase.from('sales_start_points').upsert({
    ...parsed.data,
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
  });
  if (error) return fail(error);
  revalidateSales();
  return { ok: true, data: { placed: !!coordinates } };
}

const dayEndsSchema = z.object({
  salesperson_id: z.string().uuid(),
  visit_date: DATE,
  start_at: z.enum(['home', 'office']),
  end_at: z.enum(['home', 'office']),
});

/** Where a day's route starts and ends: home or the office. */
export async function setDayEnds(input: z.input<typeof dayEndsSchema>): Promise<ActionResult> {
  const parsed = dayEndsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_activity' };
  const supabase = createClient();
  const { error } = await supabase.from('sales_visit_days').upsert(parsed.data);
  if (error) return fail(error);
  revalidateSales();
  return { ok: true, data: undefined };
}
