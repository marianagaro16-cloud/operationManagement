'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { businessToday } from '@/lib/datetime';
import { LINE_UNITS, STORAGE_TYPES, dueDate, mondayOf } from '@/domain/goods-reception/expected';
import { getViewer } from './data';
import { getExpectedAccess } from './expected-deliveries';
import { createReception, type ReceptionInput } from './goods-reception-actions';
import { notifyExpectedChange, notifyExpectedDifference } from './expected-notify';
import type { ActionResult } from './actions';

/**
 * Expected deliveries: mutations.
 *
 * The office writes them (RLS: can_manage_expected_deliveries). The receiver
 * never writes to the entry itself — arrival goes through two functions in
 * the database, which check that the caller sees the entry and may write to
 * the reception that closes it.
 */

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const KNOWN = [
  'expected_not_open',
  'expected_not_arrived',
  'expected_supplier_mismatch',
  'reception_already_linked',
  'reception_not_found',
  'not_authorized',
];

function mapError(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  const known = KNOWN.find((code) => message.includes(code));
  if (known) return fail(known);
  if (message.includes('violates row-level security')) return fail('not_authorized');
  return fail(message);
}

function revalidate(receptionId?: string | null) {
  revalidatePath('/goods-reception');
  revalidatePath('/agenda');
  revalidatePath('/dashboard');
  if (receptionId) revalidatePath(`/goods-reception/${receptionId}`);
}

async function access() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') return null;
  return { viewer, ...(await getExpectedAccess(viewer)) };
}

/* ------------------------------ the office ------------------------------ */

const lineSchema = z
  .object({
    product_id: z.string().uuid().nullable(),
    description: z.string().trim().max(200).nullable(),
    quantity: z.number().positive().max(9_999_999),
    unit: z.enum(LINE_UNITS),
  })
  // A catalogue product or a description, never both and never neither.
  .refine((l) => Boolean(l.product_id) !== Boolean(l.description));

const deliverySchema = z
  .object({
    supplier_id: z.string().uuid(),
    transporter_id: z.string().uuid().nullable(),
    expected_date: z.string().date().nullable(),
    expected_week: z.string().date().nullable(),
    pallets: z.number().int().positive().max(999).nullable(),
    storage: z.array(z.enum(STORAGE_TYPES)).min(1),
    note: z.string().trim().max(2000).nullable(),
    lines: z.array(lineSchema).max(50),
  })
  .refine((d) => Boolean(d.expected_date) !== Boolean(d.expected_week));

export type ExpectedDeliveryInput = z.infer<typeof deliverySchema>;

/** Enter an expected delivery, or change one that has not arrived yet. */
export async function saveExpectedDelivery(id: string | null, input: ExpectedDeliveryInput): Promise<ActionResult<string>> {
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return fail('invalid_expected');

  const ctx = await access();
  if (!ctx?.manage) return fail('not_authorized');

  const { lines, ...fields } = parsed.data;
  const when = {
    expected_date: fields.expected_date,
    // Any day of the week names that week.
    expected_week: fields.expected_week ? mondayOf(fields.expected_week) : null,
  };
  const row = { ...fields, ...when, storage: [...new Set(fields.storage)], updated_by: ctx.viewer.profile.id };

  const supabase = createClient();
  let deliveryId = id;
  let moved = false;

  if (id) {
    const { data: existing } = await supabase
      .from('expected_deliveries')
      .select('status, due_date, moved_count')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return fail('expected_not_found');
    const before = existing as { status: string; due_date: string; moved_count: number };
    if (before.status !== 'expected') return fail('expected_not_open');
    // The day may stay in the past (it is late); it may not be moved into the past.
    if (dueDate(when) !== before.due_date && dueDate(when) < businessToday()) return fail('expected_in_past');

    const { data: updated, error } = await supabase
      .from('expected_deliveries')
      .update(row)
      .eq('id', id)
      .eq('status', 'expected')
      .select('moved_count')
      .single();
    if (error) return mapError(error);
    moved = (updated as { moved_count: number }).moved_count > before.moved_count;

    const { error: cleared } = await supabase.from('expected_delivery_lines').delete().eq('delivery_id', id);
    if (cleared) return mapError(cleared);
  } else {
    if (dueDate(when) < businessToday()) return fail('expected_in_past');
    const { data, error } = await supabase
      .from('expected_deliveries')
      .insert({ ...row, created_by: ctx.viewer.profile.id })
      .select('id')
      .single();
    if (error) return mapError(error);
    deliveryId = (data as { id: string }).id;
  }

  if (lines.length > 0) {
    const { error } = await supabase
      .from('expected_delivery_lines')
      .insert(lines.map((line, sort_order) => ({ ...line, delivery_id: deliveryId, sort_order })));
    if (error) return mapError(error);
  }

  if (!id) await notifyExpectedChange('entered', deliveryId!, ctx.viewer.profile.id);
  else if (moved) await notifyExpectedChange('moved', deliveryId!, ctx.viewer.profile.id);

  revalidate();
  return { ok: true, data: deliveryId! };
}

/** Cancel one that will not come. Kept, never deleted. */
export async function cancelExpectedDelivery(id: string, reason: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail('invalid_expected');
  const ctx = await access();
  if (!ctx?.manage) return fail('not_authorized');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('expected_deliveries')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: ctx.viewer.profile.id,
      cancel_reason: reason.trim().slice(0, 500) || null,
      updated_by: ctx.viewer.profile.id,
    })
    .eq('id', id)
    .eq('status', 'expected')
    .select('id');
  if (error) return mapError(error);
  if (!data?.length) return fail('expected_not_open');

  await notifyExpectedChange('cancelled', id, ctx.viewer.profile.id);
  revalidate();
  return { ok: true, data: undefined };
}

/** Linked to the wrong reception: back to expected, the counted quantities cleared. */
export async function unlinkExpectedDelivery(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail('invalid_expected');
  const ctx = await access();
  if (!ctx?.manage) return fail('not_authorized');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('expected_deliveries')
    .update({ status: 'expected', reception_id: null, updated_by: ctx.viewer.profile.id })
    .eq('id', id)
    .eq('status', 'arrived')
    .select('reception_id');
  if (error) return mapError(error);
  if (!data?.length) return fail('expected_not_arrived');

  await supabase.from('expected_delivery_lines').update({ received_quantity: null }).eq('delivery_id', id);
  revalidate();
  revalidatePath('/goods-reception', 'layout');
  return { ok: true, data: undefined };
}

/* ------------------------------- arrival -------------------------------- */

const receivedSchema = z
  .array(z.object({ id: z.string().uuid(), received: z.number().min(0).max(9_999_999).nullable() }))
  .max(50);

export type ReceivedLine = z.infer<typeof receivedSchema>[number];

async function record(deliveryId: string, receptionId: string, lines: ReceivedLine[], actorId: string): Promise<ActionResult<boolean>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('record_expected_received', {
    p_delivery: deliveryId,
    p_lines: lines.map((l) => ({ id: l.id, received: l.received === null ? null : String(l.received) })),
  });
  if (error) return mapError(error);
  const differs = data === true;
  if (differs) await notifyExpectedDifference(deliveryId, receptionId, actorId);
  return { ok: true, data: differs };
}

/**
 * The delivery arrived: its reception is registered and closes the entry.
 *
 * `linked` is false when the reception was saved but the entry could not be
 * closed with it (someone else just did) — the reception then offers the
 * link again rather than the receiver losing what they typed.
 */
export async function registerExpectedArrival(
  input: ReceptionInput,
  deliveryId: string,
  lines: ReceivedLine[],
): Promise<ActionResult<{ id: string; linked: boolean; differs: boolean }>> {
  const parsedLines = receivedSchema.safeParse(lines);
  if (!z.string().uuid().safeParse(deliveryId).success || !parsedLines.success) return fail('invalid_expected');

  const ctx = await access();
  if (!ctx?.see) return fail('not_authorized');

  const supabase = createClient();
  const { data: delivery } = await supabase
    .from('expected_deliveries')
    .select('status, supplier_id')
    .eq('id', deliveryId)
    .maybeSingle();
  if (!delivery || (delivery as { status: string }).status !== 'expected') return fail('expected_not_open');
  if ((delivery as { supplier_id: string }).supplier_id !== input.supplier_id) return fail('expected_supplier_mismatch');

  const created = await createReception(input);
  if (!created.ok) return created;
  const receptionId = created.data;

  const { error } = await supabase.rpc('link_expected_delivery', { p_delivery: deliveryId, p_reception: receptionId });
  if (error) return { ok: true, data: { id: receptionId, linked: false, differs: false } };

  const recorded = await record(deliveryId, receptionId, parsedLines.data, ctx.viewer.profile.id);
  revalidate(receptionId);
  return { ok: true, data: { id: receptionId, linked: true, differs: recorded.ok && recorded.data } };
}

/** "Is it this one?", answered on a reception already registered. */
export async function linkExpectedDelivery(deliveryId: string, receptionId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(deliveryId).success || !z.string().uuid().safeParse(receptionId).success) {
    return fail('invalid_expected');
  }
  const ctx = await access();
  if (!ctx?.see) return fail('not_authorized');

  const supabase = createClient();
  const { error } = await supabase.rpc('link_expected_delivery', { p_delivery: deliveryId, p_reception: receptionId });
  if (error) return mapError(error);

  revalidate(receptionId);
  return { ok: true, data: undefined };
}

/** What the receiver counted against the announced lines. Returns whether it differs. */
export async function recordExpectedReceived(
  deliveryId: string,
  receptionId: string,
  lines: ReceivedLine[],
): Promise<ActionResult<boolean>> {
  const parsed = receivedSchema.safeParse(lines);
  if (!z.string().uuid().safeParse(deliveryId).success || !parsed.success) return fail('invalid_expected');
  const ctx = await access();
  if (!ctx?.see) return fail('not_authorized');

  const res = await record(deliveryId, receptionId, parsed.data, ctx.viewer.profile.id);
  if (res.ok) revalidate(receptionId);
  return res;
}
