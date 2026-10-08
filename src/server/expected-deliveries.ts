import 'server-only';
import { DateTime } from 'luxon';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_TZ, addDays, type BusinessDate } from '@/lib/datetime';
import { canManageExpectedDeliveries, type Role } from '@/lib/authz';
import type { ReportExpected } from '@/domain/goods-reception/expected';
import type { ExpectedDelivery } from '@/types/goods-reception';
import { isReceptionAssignee } from './goods-reception';

/**
 * Expected deliveries, read with the caller's session: RLS shows them to the
 * office and the reception list and returns nothing to anyone else.
 */

const SELECT = `
  id, supplier_id, transporter_id, expected_date, expected_week, due_date, moved_count,
  pallets, storage, note, status, reception_id, cancelled_at, cancel_reason, created_by, created_at,
  supplier:suppliers ( id, name ),
  transporter:transporters ( id, name ),
  creator:profiles!expected_deliveries_created_by_fkey ( name, email ),
  reception:goods_receptions ( id, reception_number, received_at ),
  lines:expected_delivery_lines (
    id, delivery_id, product_id, description, quantity, unit, received_quantity, sort_order,
    product:products ( id, code, name, family, presentation )
  )
`;

const sorted = (rows: unknown): ExpectedDelivery[] =>
  ((rows ?? []) as ExpectedDelivery[]).map((d) => ({
    ...d,
    lines: [...(d.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));

/**
 * What this person may do with expected deliveries. Mirrors
 * can_see_expected_deliveries() and can_manage_expected_deliveries() in SQL.
 */
export async function getExpectedAccess(viewer: { profile: { id: string }; role: Role }): Promise<{ see: boolean; manage: boolean }> {
  const manage = canManageExpectedDeliveries(viewer.role);
  return { manage, see: manage || (await isReceptionAssignee(viewer.profile.id)) };
}

/** Whether someone else's agenda holds the expected deliveries: they announce them, or receive. */
export async function personSeesExpected(personId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.from('profiles').select('role').eq('id', personId).maybeSingle();
  const role = (data as { role: Role } | null)?.role;
  return (!!role && canManageExpectedDeliveries(role)) || isReceptionAssignee(personId);
}

/** Everything still expected, soonest first. */
export async function getOpenExpected(): Promise<ExpectedDelivery[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('expected_deliveries')
    .select(SELECT)
    .eq('status', 'expected')
    .order('due_date');
  if (error) throw new Error(error.message);
  return sorted(data);
}

/** What arrived or was cancelled, latest first. */
export async function getExpectedHistory(limit = 60): Promise<ExpectedDelivery[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('expected_deliveries')
    .select(SELECT)
    .neq('status', 'expected')
    .order('due_date', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return sorted(data);
}

/** The expected delivery a reception closed, if it closed one. */
export async function getExpectedForReception(receptionId: string): Promise<ExpectedDelivery | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('expected_deliveries')
    .select(SELECT)
    .eq('reception_id', receptionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? sorted([data])[0]! : null;
}

/** Still expected from one supplier: what a new reception may be the arrival of. */
export async function getOpenExpectedForSupplier(supplierId: string): Promise<ExpectedDelivery[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('expected_deliveries')
    .select(SELECT)
    .eq('status', 'expected')
    .eq('supplier_id', supplierId)
    .order('due_date');
  if (error) throw new Error(error.message);
  return sorted(data);
}

/** For "Ahora": what did not arrive, and what comes today and tomorrow. */
export async function getExpectedSoon(today: BusinessDate): Promise<{ late: string[]; soon: string[] }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('expected_deliveries')
    .select('expected_date, due_date, supplier:suppliers ( name )')
    .eq('status', 'expected')
    .lte('due_date', addDays(today, 1))
    .order('due_date');
  if (error) return { late: [], soon: [] };
  const rows = (data ?? []) as unknown as { expected_date: string | null; due_date: string; supplier: { name: string } | null }[];
  return {
    late: rows.filter((r) => r.due_date < today).map((r) => r.supplier?.name ?? ''),
    // A week without a day is not "today": it has its own line in the list.
    soon: rows.filter((r) => r.expected_date && r.expected_date >= today).map((r) => r.supplier?.name ?? ''),
  };
}

/** The entries whose day falls in a month, for the reception report. */
export async function getExpectedForMonth(month: string): Promise<ReportExpected[]> {
  const supabase = createClient();
  const first = `${month}-01`;
  const last = DateTime.fromISO(first, { zone: BUSINESS_TZ }).endOf('month').toISODate()!;
  const { data, error } = await supabase
    .from('expected_deliveries')
    .select(SELECT)
    .gte('due_date', first)
    .lte('due_date', last)
    .order('due_date');
  if (error) throw new Error(error.message);
  return sorted(data).map((d) => ({
    id: d.id,
    supplier_id: d.supplier_id,
    supplier_name: d.supplier?.name ?? '',
    status: d.status,
    expected_date: d.expected_date,
    expected_week: d.expected_week,
    due_date: d.due_date,
    moved_count: d.moved_count,
    arrived_on: d.reception
      ? DateTime.fromISO(d.reception.received_at, { zone: 'utc' }).setZone(BUSINESS_TZ).toISODate()
      : null,
    reception_id: d.reception?.id ?? null,
    reception_number: d.reception?.reception_number ?? null,
  }));
}
