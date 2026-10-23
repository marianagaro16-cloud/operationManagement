'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { COST_KINDS, RECEIPT_BUCKET } from '@/domain/vehicle/summary';
import { getViewer } from './data';
import { getVehicle } from './vehicle';
import type { ActionResult } from './actions';

/*
 * The Palomo's rounds and costs: mutations. RLS decides who may do what —
 * Logística taps and enters road costs, corrects its own the same day; the
 * office does anything — so these only validate and translate refusals.
 */

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function mapError(error: { message?: string; code?: string } | null): { ok: false; error: string } {
  const message = error?.message ?? '';
  if (message.includes('vehicle_trips_one_out')) return fail('vehicle_already_out');
  if (message.includes('vehicle_trips_km_forward')) return fail('vehicle_km_backwards');
  if (message.includes('vehicle_trips_back_after')) return fail('vehicle_back_before_out');
  if (message.includes('row-level security') || error?.code === '42501') return fail('not_authorized');
  return fail(message || 'unknown');
}

function revalidate() {
  revalidatePath('/palomo');
  revalidatePath('/orders');
}

const km = z.number().int().min(0).max(9_999_999);
const note = z.string().trim().max(1000).nullable();

/** "Salgo": a round starts now (or at the time given), from the km on the dashboard. */
export async function startTrip(input: { left_at: string; left_km: number; note: string | null }): Promise<ActionResult<string>> {
  const parsed = z.object({ left_at: z.string().datetime({ offset: true }), left_km: km, note }).safeParse(input);
  if (!parsed.success) return fail('invalid_trip');
  const viewer = await getViewer();
  const vehicle = await getVehicle();
  if (!viewer || !vehicle) return fail('not_authorized');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('vehicle_trips')
    .insert({ ...parsed.data, vehicle_id: vehicle.id, driver_id: viewer.profile.id, created_by: viewer.profile.id })
    .select('id')
    .single();
  if (error) return mapError(error);
  revalidate();
  return { ok: true, data: (data as { id: string }).id };
}

/** "Regresé a la fábrica": the round ends, with the km now on the dashboard. */
export async function endTrip(id: string, input: { returned_at: string; returned_km: number; note: string | null }): Promise<ActionResult> {
  const parsed = z.object({ returned_at: z.string().datetime({ offset: true }), returned_km: km, note }).safeParse(input);
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return fail('invalid_trip');
  const viewer = await getViewer();
  if (!viewer) return fail('not_authorized');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('vehicle_trips')
    .update({ ...parsed.data, updated_by: viewer.profile.id })
    .eq('id', id)
    .is('returned_at', null)
    .select('id');
  if (error) return mapError(error);
  if (!data?.length) return fail('not_authorized');
  revalidate();
  return { ok: true, data: undefined };
}

/** A round corrected: the driver the same day, the office any day. The change is kept. */
export async function correctTrip(
  id: string,
  input: { left_at: string; left_km: number; returned_at: string | null; returned_km: number | null; note: string | null },
): Promise<ActionResult> {
  const parsed = z
    .object({
      left_at: z.string().datetime({ offset: true }),
      left_km: km,
      returned_at: z.string().datetime({ offset: true }).nullable(),
      returned_km: km.nullable(),
      note,
    })
    .refine((t) => (t.returned_at === null) === (t.returned_km === null))
    .safeParse(input);
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return fail('invalid_trip');
  const viewer = await getViewer();
  if (!viewer) return fail('not_authorized');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('vehicle_trips')
    .update({ ...parsed.data, updated_by: viewer.profile.id })
    .eq('id', id)
    .select('id');
  if (error) return mapError(error);
  if (!data?.length) return fail('not_authorized');
  revalidate();
  return { ok: true, data: undefined };
}

/** Entered by mistake: the office only. */
export async function deleteTrip(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail('invalid_trip');
  const supabase = createClient();
  const { data, error } = await supabase.from('vehicle_trips').delete().eq('id', id).select('id');
  if (error) return mapError(error);
  if (!data?.length) return fail('not_authorized');
  revalidate();
  return { ok: true, data: undefined };
}

const costSchema = z
  .object({
    kind: z.enum(COST_KINDS),
    spent_on: z.string().date(),
    amount: z.number().positive().max(999_999),
    litres: z.number().positive().max(9_999).nullable(),
    odometer_km: km.nullable(),
    note,
    receipt_path: z.string().max(300).nullable(),
  })
  .refine((c) => c.litres === null || c.kind === 'fuel');

export type VehicleCostInput = z.infer<typeof costSchema>;

/** A cost entered, or corrected. The receipt was uploaded by the browser into the person's own folder. */
export async function saveCost(id: string | null, input: VehicleCostInput): Promise<ActionResult> {
  const parsed = costSchema.safeParse(input);
  if (!parsed.success || (id !== null && !z.string().uuid().safeParse(id).success)) return fail('invalid_cost');
  const viewer = await getViewer();
  const vehicle = await getVehicle();
  if (!viewer || !vehicle) return fail('not_authorized');
  // Someone else's folder is not theirs to point at.
  if (parsed.data.receipt_path && !parsed.data.receipt_path.startsWith(`${viewer.profile.id}/`) && !id) return fail('not_authorized');

  const supabase = createClient();
  const { data, error } = id
    ? await supabase.from('vehicle_costs').update(parsed.data).eq('id', id).select('id')
    : await supabase.from('vehicle_costs').insert({ ...parsed.data, vehicle_id: vehicle.id, created_by: viewer.profile.id }).select('id');
  if (error) return mapError(error);
  if (!data?.length) return fail('not_authorized');
  revalidate();
  return { ok: true, data: undefined };
}

export async function deleteCost(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail('invalid_cost');
  const supabase = createClient();
  const { data, error } = await supabase.from('vehicle_costs').delete().eq('id', id).select('id, receipt_path');
  if (error) return mapError(error);
  if (!data?.length) return fail('not_authorized');
  const path = (data[0] as { receipt_path: string | null }).receipt_path;
  if (path) await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
  revalidate();
  return { ok: true, data: undefined };
}
