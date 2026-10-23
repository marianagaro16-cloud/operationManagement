import 'server-only';
import { DateTime } from 'luxon';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ } from '@/lib/datetime';
import { RECEIPT_BUCKET, type CostKind, type RepairCost } from '@/domain/vehicle/summary';
import type { Role } from '@/lib/authz';

/*
 * The Palomo's rounds and costs (2026-10-23). Read as the viewer: RLS gives
 * the office everything and a driver only their own.
 */

export interface VehicleTrip {
  id: string;
  vehicle_id: string;
  trip_date: string;
  driver_id: string;
  left_at: string;
  left_km: number;
  returned_at: string | null;
  returned_km: number | null;
  note: string | null;
  driver: { name: string | null; email: string } | null;
}

export interface VehicleCost {
  id: string;
  vehicle_id: string;
  kind: CostKind;
  spent_on: string;
  amount: number | string;
  litres: number | string | null;
  odometer_km: number | null;
  note: string | null;
  receipt_path: string | null;
  created_by: string;
  creator: { name: string | null; email: string } | null;
  /** A link to the receipt for an hour, where there is one. */
  receipt_url?: string | null;
}

export interface VehicleAccess {
  /** Owners, Admin, Power User: everything, any day, and the summary. */
  office: boolean;
  /** Logística, or covering someone in it: taps out and back, enters fuel and parking. */
  driver: boolean;
}

/** Mirrors vehicle_office() and vehicle_driver() in SQL. */
export async function getVehicleAccess(viewer: { role: Role }): Promise<VehicleAccess> {
  const office = viewer.role === 'owner' || viewer.role === 'admin' || viewer.role === 'power_user';
  const supabase = createClient();
  const { data } = await supabase.rpc('vehicle_driver');
  return { office, driver: data === true };
}

/** The Palomo: the one vehicle today; the first, should a second van come. */
export async function getVehicle(): Promise<{ id: string; name: string } | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('equipment')
    .select('id, name')
    .eq('is_vehicle', true)
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

const TRIP_SELECT = 'id, vehicle_id, trip_date, driver_id, left_at, left_km, returned_at, returned_km, note, driver:profiles!vehicle_trips_driver_id_fkey ( name, email )';

/** The round out right now, whoever drives it — the office sees it, a driver only their own. */
export async function getOpenTrip(vehicleId: string): Promise<VehicleTrip | null> {
  const supabase = createClient();
  const { data } = await supabase.from('vehicle_trips').select(TRIP_SELECT).eq('vehicle_id', vehicleId).is('returned_at', null).maybeSingle();
  return (data as unknown as VehicleTrip | null) ?? null;
}

/** Rounds between two days, latest first. */
export async function getTrips(vehicleId: string, from: string, to: string): Promise<VehicleTrip[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('vehicle_trips')
    .select(TRIP_SELECT)
    .eq('vehicle_id', vehicleId)
    .gte('trip_date', from)
    .lte('trip_date', to)
    .order('left_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as VehicleTrip[];
}

/**
 * The odometer the van last showed, to start the next round from. As the
 * system: a driver may not read the others' rounds, but the van's km is not
 * theirs to keep from the next one who drives.
 */
export async function getLastKm(vehicleId: string): Promise<number | null> {
  const admin = createAdminClient();
  const [{ data: trip }, { data: cost }] = await Promise.all([
    admin.from('vehicle_trips').select('left_km, returned_km').eq('vehicle_id', vehicleId).order('left_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('vehicle_costs').select('odometer_km').eq('vehicle_id', vehicleId).not('odometer_km', 'is', null).order('odometer_km', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const t = trip as { left_km: number; returned_km: number | null } | null;
  const fromTrip = t ? t.returned_km ?? t.left_km : null;
  const fromCost = (cost as { odometer_km: number } | null)?.odometer_km ?? null;
  if (fromTrip === null) return fromCost;
  return fromCost === null ? fromTrip : Math.max(fromTrip, fromCost);
}

/** Costs between two days, latest first, each receipt with a link. */
export async function getCosts(vehicleId: string, from: string, to: string): Promise<VehicleCost[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('vehicle_costs')
    .select('id, vehicle_id, kind, spent_on, amount, litres, odometer_km, note, receipt_path, created_by, creator:profiles!vehicle_costs_created_by_fkey ( name, email )')
    .eq('vehicle_id', vehicleId)
    .gte('spent_on', from)
    .lte('spent_on', to)
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const costs = (data ?? []) as unknown as VehicleCost[];

  const paths = costs.map((c) => c.receipt_path).filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrls(paths, 60 * 60);
    const urls = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path!, s.signedUrl]));
    for (const c of costs) c.receipt_url = c.receipt_path ? urls.get(c.receipt_path) ?? null : null;
  }
  return costs;
}

/**
 * The repairs Mantenimiento recorded on the van, with their cost. As the
 * system — repair requests have rules of their own — and only ever called
 * for the office's summary.
 */
export async function getRepairCosts(vehicleId: string, from: string): Promise<RepairCost[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('repair_requests')
    .select('fixed_at, cost')
    .eq('equipment_id', vehicleId)
    .not('fixed_at', 'is', null)
    .gte('fixed_at', `${from}T00:00:00Z`);
  return ((data ?? []) as { fixed_at: string; cost: number | string | null }[]).map((r) => ({
    fixed_on: DateTime.fromISO(r.fixed_at, { zone: 'utc' }).setZone(BUSINESS_TZ).toISODate()!,
    cost: r.cost,
  }));
}
