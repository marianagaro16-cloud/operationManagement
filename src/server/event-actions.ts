'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { geocodeAddress } from './geocode';
import { sendToUser } from './push';
import type { ActionResult } from './actions';

/*
 * Events writes. Who may is the database's decision (is_sales() in the
 * RLS and in event_confirm()). An event's tasks are planned sales
 * activities with its id, so they live in their responsible person's
 * Planning; its staff are shifts; its budget, cost lines.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'invalid_time' });
const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const uuid = z.string().uuid();

const KNOWN = [
  'not_authorized', 'owner_not_sales', 'owner_required', 'event_not_idea', 'event_not_found',
  'events_dates', 'events_cancel_reason', 'event_shifts_one_person', 'event_shifts_times', 'salesperson_not_sales',
  'event_closed', 'event_order_ready', 'event_order_shipped', 'duplicate_product', 'invalid_quantity', 'invalid_delivery',
  'product_not_found',
];
function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: KNOWN.find((c) => error.message.includes(c)) ?? error.message };
}
function revalidateEvent(id?: string) {
  revalidatePath('/events');
  if (id) revalidatePath(`/events/${id}`);
  revalidatePath('/sales');
  revalidatePath('/orders');
  revalidatePath('/dashboard');
}

/* -------------------------------- events -------------------------------- */

const eventSchema = z
  .object({
    kind_id: uuid,
    name: z.string().trim().min(1, { message: 'name_required' }).max(200),
    start_date: DATE,
    end_date: DATE,
    open_time: TIME.nullable().optional().transform((v) => v ?? null),
    close_time: TIME.nullable().optional().transform((v) => v ?? null),
    place_name: text(200),
    street: text(200),
    postal_code: text(20),
    city: text(100),
    customer_id: uuid.nullable().optional().transform((v) => v ?? null),
    owner_id: uuid.nullable().optional().transform((v) => v ?? null),
    description: text(5000),
  })
  .refine((e) => e.end_date >= e.start_date, { message: 'events_dates' });

export type EventInput = z.input<typeof eventSchema>;

/** Create an event (an idea) or change one; the address is placed on the map when it changes. */
export async function saveEvent(input: EventInput, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_event' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const address = { street: parsed.data.street, postal_code: parsed.data.postal_code, city: parsed.data.city };
  const before = id ? (await supabase.from('events').select('street, postal_code, city').eq('id', id).maybeSingle()).data : null;
  const changed = !before || before.street !== address.street || before.postal_code !== address.postal_code || before.city !== address.city;
  let placed = {};
  if (changed && (address.street || address.city)) {
    const c = await geocodeAddress(address);
    placed = { latitude: c?.latitude ?? null, longitude: c?.longitude ?? null };
  }

  const row = { ...parsed.data, ...placed };
  const { data, error } = id
    ? await supabase.from('events').update(row).eq('id', id).select('id').single()
    : await supabase.from('events').insert({ ...row, created_by: user?.id ?? null }).select('id').single();
  if (error) return fail(error);
  const saved = (data as { id: string }).id;
  revalidateEvent(saved);
  return { ok: true, data: { id: saved } };
}

/** Confirm an idea: the kind's standard tasks are planned for the responsible person. */
export async function confirmEvent(id: string): Promise<ActionResult<{ tasks: number }>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('event_confirm', { p_event_id: id });
  if (error) return fail(error);
  revalidateEvent(id);
  return { ok: true, data: { tasks: (data as number) ?? 0 } };
}

export async function markEventDone(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('events').update({ stage: 'done' }).eq('id', id).eq('stage', 'confirmed');
  if (error) return fail(error);
  revalidateEvent(id);
  return { ok: true, data: undefined };
}

/**
 * Cancelled, with a reason: what was still planned for it comes off the
 * plans, and its order is cancelled — unless it already left ('kept').
 */
export async function cancelEvent(id: string, reason: string): Promise<ActionResult<{ order: 'none' | 'cancelled' | 'kept' }>> {
  if (!reason.trim()) return { ok: false, error: 'events_cancel_reason' };
  const supabase = createClient();
  const { data, error } = await supabase.rpc('event_cancel', { p_event_id: id, p_reason: reason.trim() });
  if (error) return fail(error);
  revalidateEvent(id);
  return { ok: true, data: { order: (data as 'none' | 'cancelled' | 'kept') ?? 'none' } };
}

/* ------------------------------- products -------------------------------- */

const productsSchema = z
  .array(
    z.object({
      product_id: uuid,
      quantity: z.number().positive({ message: 'invalid_quantity' }).max(1_000_000),
      note: text(500),
    }),
  )
  .max(200)
  .refine((lines) => new Set(lines.map((l) => l.product_id)).size === lines.length, { message: 'duplicate_product' });

/** What we take. Once the event has an order, this changes the order's lines. */
export async function setEventProducts(eventId: string, lines: z.input<typeof productsSchema>): Promise<ActionResult> {
  const parsed = productsSchema.safeParse(lines);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_quantity' };
  const supabase = createClient();
  const { error } = await supabase.rpc('event_set_products', { p_event_id: eventId, p_lines: parsed.data });
  if (error) return fail(error);
  revalidateEvent(eventId);
  return { ok: true, data: undefined };
}

/** When and how it goes — on the order too, until it has left. */
export async function setEventDelivery(eventId: string, date: string, methodId: string): Promise<ActionResult> {
  if (!DATE.safeParse(date).success || !uuid.safeParse(methodId).success) return { ok: false, error: 'invalid_delivery' };
  const supabase = createClient();
  const { error } = await supabase.rpc('event_set_delivery', { p_event_id: eventId, p_date: date, p_method_id: methodId });
  if (error) return fail(error);
  revalidateEvent(eventId);
  return { ok: true, data: undefined };
}

const returnsSchema = z
  .array(
    z.object({
      product_id: uuid,
      back_quantity: z.number().min(0).max(1_000_000),
      discarded_quantity: z.number().min(0).max(1_000_000),
    }),
  )
  .max(200);

/** Per product: what came back in good condition, and what was thrown away. Recorded only. */
export async function saveReturns(eventId: string, rows: z.input<typeof returnsSchema>): Promise<ActionResult> {
  const parsed = returnsSchema.safeParse(rows);
  if (!parsed.success || !uuid.safeParse(eventId).success) return { ok: false, error: 'invalid_quantity' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('event_returns').upsert(
    parsed.data.map((r) => ({ ...r, event_id: eventId, updated_by: user?.id ?? null })),
    { onConflict: 'event_id,product_id' },
  );
  if (error) return fail(error);
  revalidateEvent(eventId);
  return { ok: true, data: undefined };
}

/** Only an idea can be thrown away; anything further is cancelled instead. */
export async function deleteIdea(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('events').delete().eq('id', id).eq('stage', 'idea').select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'event_not_idea' };
  revalidateEvent();
  return { ok: true, data: undefined };
}

/* --------------------------------- tasks --------------------------------- */

const taskSchema = z.object({
  event_id: uuid,
  title: z.string().trim().min(1, { message: 'title_required' }).max(300),
  activity_date: DATE,
  salesperson_id: uuid,
});

/** A task of the event: planned for someone in sales, on its deadline, in their Planning. */
export async function addEventTask(input: z.input<typeof taskSchema>): Promise<ActionResult> {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_task' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: kind } = await supabase.from('sales_activity_kinds').select('id').eq('slug', 'event_task').maybeSingle();
  if (!kind) return { ok: false, error: 'not_authorized' };
  const { error } = await supabase.from('sales_activities').insert({
    ...parsed.data,
    kind_id: kind.id,
    created_by: user?.id ?? null,
  });
  if (error) return fail(error);
  revalidateEvent(parsed.data.event_id);
  return { ok: true, data: undefined };
}

/** Change a task still to do: what, by when, who. */
export async function updateEventTask(id: string, input: z.input<typeof taskSchema>): Promise<ActionResult> {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_task' };
  const { event_id, ...change } = parsed.data;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sales_activities')
    .update(change)
    .eq('id', id)
    .eq('event_id', event_id)
    .eq('status', 'planned')
    .select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidateEvent(event_id);
  return { ok: true, data: undefined };
}

/* --------------------------------- staff --------------------------------- */

const shiftSchema = z
  .object({
    event_id: uuid,
    shift_date: DATE,
    start_time: TIME.nullable().optional().transform((v) => v ?? null),
    end_time: TIME.nullable().optional().transform((v) => v ?? null),
    person: z.object({ kind: z.enum(['profile', 'worker']), id: uuid }),
    note: text(300),
  })
  .refine((s) => !s.end_time || (!!s.start_time && s.end_time > s.start_time), { message: 'event_shifts_times' });

/** Someone works at the event on a day; an app user is told. */
export async function addShift(input: z.input<typeof shiftSchema>): Promise<ActionResult> {
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_shift' };
  const v = parsed.data;
  const supabase = createClient();
  const { error } = await supabase.from('event_shifts').insert({
    event_id: v.event_id,
    shift_date: v.shift_date,
    start_time: v.start_time,
    end_time: v.end_time,
    profile_id: v.person.kind === 'profile' ? v.person.id : null,
    hr_worker_id: v.person.kind === 'worker' ? v.person.id : null,
    note: v.note,
  });
  if (error) return fail(error);

  if (v.person.kind === 'profile') {
    const { data: event } = await supabase.from('events').select('name').eq('id', v.event_id).maybeSingle();
    const day = DateTime.fromISO(v.shift_date, { zone: BUSINESS_TZ }).setLocale('es').toFormat('cccc d.M.');
    const hours = v.start_time ? ` · ${v.start_time.slice(0, 5)}${v.end_time ? `–${v.end_time.slice(0, 5)}` : ''}` : '';
    try {
      // Written in Spanish, like every other server-sent notification.
      await sendToUser(v.person.id, {
        title: 'Turno en un evento',
        body: `${event?.name ?? ''}: ${day}${hours}`,
        url: '/dashboard',
        tag: `event-shift-${v.event_id}-${v.person.id}-${v.shift_date}`,
      });
    } catch (err) {
      console.error('event shift notice failed', err);
    }
  }
  revalidateEvent(v.event_id);
  return { ok: true, data: undefined };
}

export async function removeShift(id: string, eventId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('event_shifts').delete().eq('id', id);
  if (error) return fail(error);
  revalidateEvent(eventId);
  return { ok: true, data: undefined };
}

/* --------------------------------- budget -------------------------------- */

const money = z.number().min(0).max(10_000_000).nullable().optional().transform((v) => v ?? null);
const costSchema = z.object({
  event_id: uuid,
  type_id: uuid,
  description: text(300),
  planned_amount: money,
  actual_amount: money,
});

export async function saveCost(input: z.input<typeof costSchema>, id?: string): Promise<ActionResult> {
  const parsed = costSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_cost' };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('event_costs').update(parsed.data).eq('id', id)
    : await supabase.from('event_costs').insert(parsed.data);
  if (error) return fail(error);
  revalidateEvent(parsed.data.event_id);
  return { ok: true, data: undefined };
}

export async function removeCost(id: string, eventId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('event_costs').delete().eq('id', id);
  if (error) return fail(error);
  revalidateEvent(eventId);
  return { ok: true, data: undefined };
}

/* ----------------------------- Admin's lists ----------------------------- */

const entrySchema = z.object({
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

export type EventEntryInput = z.input<typeof entrySchema>;

/** Event kinds and cost types (RLS: is_admin). */
export async function saveEventEntry(list: 'kinds' | 'cost_types', input: EventEntryInput, id?: string): Promise<ActionResult> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_entry' };
  const table = list === 'kinds' ? 'event_kinds' : 'event_cost_types';
  const supabase = createClient();
  const { error } = id ? await supabase.from(table).update(parsed.data).eq('id', id) : await supabase.from(table).insert(parsed.data);
  if (error) return fail(error);
  revalidatePath('/admin/events');
  revalidatePath('/events', 'layout');
  return { ok: true, data: undefined };
}

const kindTaskSchema = z.object({
  kind_id: uuid,
  title: z.string().trim().min(1, { message: 'title_required' }).max(300),
  translations: entrySchema.shape.translations,
  anchor: z.enum(['start', 'end']),
  days: z.number().int().min(-365).max(365),
  sort_order: z.number().int().default(100),
});

/** A kind's standard task (RLS: is_admin). */
export async function saveKindTask(input: z.input<typeof kindTaskSchema>, id?: string): Promise<ActionResult> {
  const parsed = kindTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_task' };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('event_kind_tasks').update(parsed.data).eq('id', id)
    : await supabase.from('event_kind_tasks').insert(parsed.data);
  if (error) return fail(error);
  revalidatePath('/admin/events');
  return { ok: true, data: undefined };
}

export async function removeKindTask(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('event_kind_tasks').delete().eq('id', id);
  if (error) return fail(error);
  revalidatePath('/admin/events');
  return { ok: true, data: undefined };
}
