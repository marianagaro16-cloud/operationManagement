'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { NOTE_KINDS, OPEN_STAGES } from '@/types/sales';
import { saveReminder } from './reminder-actions';
import { geocodeAddress } from './geocode';
import type { ActionResult } from './actions';

/*
 * Sales writes. Who is sales is the database's decision (is_sales() in the
 * notes' RLS). A note is only ever added; a follow-up is an ordinary
 * reminder, linked to the customer, so it arrives, snoozes and shows on the
 * dashboard like every other.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });

/** Follow-ups arrive in the morning, like the day's other notices. */
const FOLLOW_UP_TIME = '09:00';

const noteSchema = z.object({
  customer_id: z.string().uuid(),
  kind: z.enum(NOTE_KINDS),
  note_date: DATE,
  body: z.string().trim().min(1, { message: 'body_required' }).max(5000),
  follow_up_on: DATE.nullable(),
});

export async function addCustomerNote(
  input: z.input<typeof noteSchema>,
): Promise<ActionResult<{ id: string; followUp: 'none' | 'created' | 'failed' }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_note' };
  const v = parsed.data;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: note, error } = await supabase
    .from('customer_notes')
    .insert({ customer_id: v.customer_id, kind: v.kind, note_date: v.note_date, body: v.body, created_by: user?.id ?? null })
    .select('id')
    .single();
  if (error) {
    return { ok: false, error: error.message.includes('row-level security') ? 'not_authorized' : error.message };
  }

  let followUp: 'none' | 'created' | 'failed' = 'none';
  if (v.follow_up_on) {
    const { data: customer } = await supabase
      .from('customers')
      .select('company_name')
      .eq('id', v.customer_id)
      .maybeSingle();
    // The note is saved either way; a failed follow-up is reported, not undone.
    const res = await saveReminder({
      id: null,
      title: `Seguimiento: ${customer?.company_name ?? ''}`.trim(),
      notes: v.body,
      date: v.follow_up_on,
      time: FOLLOW_UP_TIME,
      timezone: BUSINESS_TZ,
      recurrence: 'none',
      notifyBefore: null,
      link: { type: 'customer', id: v.customer_id },
      participantIds: [],
    });
    followUp = res.ok ? 'created' : 'failed';
  }

  revalidatePath(`/sales/customers/${v.customer_id}`);
  revalidatePath('/sales');
  return { ok: true, data: { id: (note as { id: string }).id, followUp } };
}

/* ------------------------------- prospects ------------------------------- */

const PROSPECT_ERRORS = [
  'not_authorized', 'prospect_closed', 'owner_not_sales', 'use_win_or_lose',
  'lost_reason_required', 'prospect_not_found', 'prospects_open_has_next_step',
];

function prospectFail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: PROSPECT_ERRORS.find((code) => error.message.includes(code)) ?? error.message };
}

const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

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
  next_step: z.string().trim().min(1, { message: 'next_step_required' }).max(300),
  next_step_on: DATE,
  owner_id: z.string().uuid({ message: 'owner_required' }),
});

export type ProspectInput = z.input<typeof prospectSchema>;

/** Create a prospect, or change an open one. Won and lost have their own actions. */
export async function saveProspect(input: ProspectInput, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = prospectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_prospect' };

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
  if (error) return prospectFail(error);

  const saved = (data as { id: string }).id;
  revalidatePath('/sales');
  revalidatePath(`/sales/prospects/${saved}`);
  revalidatePath('/dashboard');
  return { ok: true, data: { id: saved } };
}

const prospectNoteSchema = z.object({
  prospect_id: z.string().uuid(),
  kind: z.enum(NOTE_KINDS),
  note_date: DATE,
  body: z.string().trim().min(1, { message: 'body_required' }).max(5000),
});

export async function addProspectNote(input: z.input<typeof prospectNoteSchema>): Promise<ActionResult> {
  const parsed = prospectNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_note' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('prospect_notes').insert({ ...parsed.data, created_by: user?.id ?? null });
  if (error) return prospectFail(error);
  revalidatePath(`/sales/prospects/${parsed.data.prospect_id}`);
  return { ok: true, data: undefined };
}

/** Won: the customer is created and the notes go to its file. Returns the customer. */
export async function winProspect(id: string): Promise<ActionResult<{ customerId: string }>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('sales_prospect_win', { p_prospect_id: id });
  if (error) return prospectFail(error);
  revalidatePath('/sales');
  revalidatePath(`/sales/prospects/${id}`);
  revalidatePath('/dashboard');
  return { ok: true, data: { customerId: data as string } };
}

export async function loseProspect(id: string, reasonId: string, note: string | null): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(reasonId).success) return { ok: false, error: 'lost_reason_required' };
  const supabase = createClient();
  const { error } = await supabase.rpc('sales_prospect_lose', { p_prospect_id: id, p_reason_id: reasonId, p_note: note ?? '' });
  if (error) return prospectFail(error);
  revalidatePath('/sales');
  revalidatePath(`/sales/prospects/${id}`);
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

/* ------------------------- Admin's prospect lists ------------------------- */

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

/** How we found a prospect, or why one was lost: Admin's lists (RLS: is_admin). */
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
  if (error) return prospectFail(error);
  revalidatePath('/admin/sales');
  revalidatePath('/sales', 'layout');
  return { ok: true, data: undefined };
}

/* --------------------------------- visits -------------------------------- */

function revalidateVisits() {
  revalidatePath('/sales');
  revalidatePath('/dashboard');
}

function visitFail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  for (const code of ['salesperson_not_sales', 'visit_recorded', 'sales_visits_one_target']) {
    if (error.message.includes(code)) return { ok: false, error: code };
  }
  return { ok: false, error: error.message };
}

const startSchema = z.object({
  user_id: z.string().uuid(),
  street: text(200),
  postal_code: text(20),
  city: text(100),
});

/** Where a salesperson's day starts and ends; placed on the map on save. */
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
  if (error) return visitFail(error);
  revalidateVisits();
  return { ok: true, data: { placed: !!coordinates } };
}

const visitSchema = z.object({
  salesperson_id: z.string().uuid(),
  visit_date: DATE,
  kind: z.enum(['customer', 'prospect']),
  target_id: z.string().uuid(),
  planned_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().transform((v) => v || null),
  purpose: text(300),
});

/** Put someone on a day's plan, at the end of the route. */
export async function addVisit(input: z.input<typeof visitSchema>): Promise<ActionResult> {
  const parsed = visitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_visit' };
  const v = parsed.data;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: last } = await supabase
    .from('sales_visits')
    .select('position')
    .eq('salesperson_id', v.salesperson_id)
    .eq('visit_date', v.visit_date)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from('sales_visits').insert({
    salesperson_id: v.salesperson_id,
    visit_date: v.visit_date,
    customer_id: v.kind === 'customer' ? v.target_id : null,
    prospect_id: v.kind === 'prospect' ? v.target_id : null,
    planned_time: v.planned_time,
    purpose: v.purpose,
    position: (last?.position ?? 0) + 1,
    created_by: user?.id ?? null,
  });
  if (error) return visitFail(error);
  revalidateVisits();
  return { ok: true, data: undefined };
}

/** Off the plan — only while it has no result. */
export async function removeVisit(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('sales_visits').delete().eq('id', id).eq('status', 'planned').select('id');
  if (error) return visitFail(error);
  if (!data?.length) return { ok: false, error: 'visit_recorded' };
  revalidateVisits();
  return { ok: true, data: undefined };
}

/** Write a day's route order, 1..n. */
export async function setVisitOrder(ids: string[]): Promise<ActionResult> {
  const valid = z.array(z.string().uuid()).max(100).safeParse(ids);
  if (!valid.success) return { ok: false, error: 'invalid_visit' };
  const supabase = createClient();
  for (const [index, id] of valid.data.entries()) {
    const { error } = await supabase.from('sales_visits').update({ position: index + 1 }).eq('id', id);
    if (error) return visitFail(error);
  }
  revalidateVisits();
  return { ok: true, data: undefined };
}

const resultSchema = z.object({
  visit_id: z.string().uuid(),
  status: z.enum(['done', 'not_done']),
  note: text(5000),
  /** A customer's follow-up: a reminder that day. */
  follow_up_on: DATE.nullable().optional().transform((v) => v ?? null),
  /** A prospect's follow-up: its next step and date. */
  next_step: text(300),
  next_step_on: DATE.nullable().optional().transform((v) => v ?? null),
});

/**
 * After the visit: done or not done, and what happened — a Visit note on the
 * customer or prospect. A customer's follow-up is a reminder; a prospect's
 * is its next step.
 */
export async function recordVisit(input: z.input<typeof resultSchema>): Promise<ActionResult<{ followUp: 'none' | 'created' | 'failed' }>> {
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_visit' };
  const v = parsed.data;
  const supabase = createClient();

  const { data: visit, error: readError } = await supabase
    .from('sales_visits')
    .select('visit_date, status, customer_id, prospect_id')
    .eq('id', v.visit_id)
    .maybeSingle();
  if (readError) return visitFail(readError);
  if (!visit) return { ok: false, error: 'not_authorized' };
  if (visit.status !== 'planned') return { ok: false, error: 'visit_recorded' };

  const { error } = await supabase
    .from('sales_visits')
    .update({ status: v.status, done_at: new Date().toISOString() })
    .eq('id', v.visit_id);
  if (error) return visitFail(error);

  let followUp: 'none' | 'created' | 'failed' = 'none';
  if (visit.customer_id && (v.note || v.follow_up_on)) {
    const res = await addCustomerNote({
      customer_id: visit.customer_id,
      kind: 'visit',
      note_date: visit.visit_date,
      body: v.note ?? (v.status === 'done' ? 'Visita' : 'Visita no realizada'),
      follow_up_on: v.follow_up_on,
    });
    followUp = res.ok ? res.data.followUp : 'failed';
  }
  if (visit.prospect_id) {
    if (v.note) {
      await addProspectNote({ prospect_id: visit.prospect_id, kind: 'visit', note_date: visit.visit_date, body: v.note });
    }
    if (v.next_step && v.next_step_on) {
      const { error: stepError } = await supabase
        .from('prospects')
        .update({ next_step: v.next_step, next_step_on: v.next_step_on })
        .eq('id', visit.prospect_id);
      followUp = stepError ? 'failed' : 'created';
    }
  }

  revalidateVisits();
  return { ok: true, data: { followUp } };
}

const dayEndsSchema = z.object({
  salesperson_id: z.string().uuid(),
  visit_date: DATE,
  start_at: z.enum(['home', 'office']),
  end_at: z.enum(['home', 'office']),
});

/** Where a day of visits starts and ends: home or the office. */
export async function setDayEnds(input: z.input<typeof dayEndsSchema>): Promise<ActionResult> {
  const parsed = dayEndsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_visit' };
  const supabase = createClient();
  const { error } = await supabase.from('sales_visit_days').upsert(parsed.data);
  if (error) return visitFail(error);
  revalidateVisits();
  return { ok: true, data: undefined };
}
