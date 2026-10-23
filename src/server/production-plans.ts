import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { addDays } from '@/lib/datetime';
import { latestLots, type LineFactors, type MaterialLot, type OrderForPlan, type PlanProduct, type PlanSection } from '@/domain/production-plan/plan';

/*
 * Production plans (2026-10-23): the Excel "Plan de Producción" sheet in the
 * app. RLS decides who reads what (can_read_production_plan): planners and the
 * Production manager every plan, Production's users today's.
 */

export interface ProductionLine extends LineFactors {
  id: string;
  slug: string;
  name: string;
  machine: string | null;
  sort_order: number;
  is_active: boolean;
  standing_notes: string | null;
  /** The Materia Prima items its plans carry a lot for. */
  material_item_ids: string[];
}

export interface LineProduct extends PlanProduct {
  line_id: string;
  code: string | null;
  name: string;
}

export interface ProductionPlanSummary {
  id: string;
  line_id: string;
  plan_date: string;
  notes: string | null;
  row_count: number;
}

export interface PlanRow {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  label: string | null;
  is_reserve: boolean;
  delivery_date: string | null;
  delivery_note: string | null;
  order_ids: string[];
  sort_order: number;
  quantities: Record<string, number>;
}

export interface ProductionPlan {
  id: string;
  line_id: string;
  plan_date: string;
  notes: string | null;
  material_lots: MaterialLot[];
  updated_at: string;
  rows: PlanRow[];
}

const LINE = 'id, slug, name, machine, sort_order, is_active, standing_notes, material_item_ids, pure_share, waste, masa_per_grain_kg, sack_kg, totopo_factor, evaporation, flour_factor, water_factor, salt_factor';
const num = (v: unknown) => (v == null ? null : Number(v));

function toLine(r: Record<string, unknown>): ProductionLine {
  return {
    ...(r as unknown as ProductionLine),
    pure_share: Number(r.pure_share),
    waste: Number(r.waste),
    masa_per_grain_kg: Number(r.masa_per_grain_kg),
    sack_kg: Number(r.sack_kg),
    totopo_factor: Number(r.totopo_factor),
    evaporation: num(r.evaporation),
    flour_factor: num(r.flour_factor),
    water_factor: num(r.water_factor),
    salt_factor: num(r.salt_factor),
  };
}

export async function getProductionLines(): Promise<ProductionLine[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('production_lines').select(LINE).order('sort_order');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toLine(r as Record<string, unknown>));
}

/** Every line's products, with their weight from the catalogue. */
export async function getLineProducts(): Promise<LineProduct[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('production_line_products')
    .select('line_id, product_id, section, group_label, best_before_days, sort_order, product:products ( code, name, net_weight_kg )');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const row = r as unknown as {
      line_id: string; product_id: string; section: PlanSection; group_label: string; best_before_days: number | null; sort_order: number;
      product: { code: string | null; name: string | null; net_weight_kg: number | string | null } | null;
    };
    return {
      line_id: row.line_id,
      product_id: row.product_id,
      section: row.section,
      group_label: row.group_label,
      best_before_days: row.best_before_days,
      sort_order: row.sort_order,
      code: row.product?.code ?? null,
      name: row.product?.name ?? '—',
      weight_kg: num(row.product?.net_weight_kg),
    };
  });
}

/** Plans in a date range (inclusive), newest first, with how many customer rows each has. */
export async function getProductionPlans(from: string, to: string): Promise<ProductionPlanSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('production_plans')
    .select('id, line_id, plan_date, notes, rows:production_plan_rows ( count )')
    .gte('plan_date', from)
    .lte('plan_date', to)
    .order('plan_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const row = r as unknown as { id: string; line_id: string; plan_date: string; notes: string | null; rows: { count: number }[] };
    return { id: row.id, line_id: row.line_id, plan_date: row.plan_date, notes: row.notes, row_count: row.rows?.[0]?.count ?? 0 };
  });
}

export async function getProductionPlan(id: string): Promise<ProductionPlan | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('production_plans')
    .select(`id, line_id, plan_date, notes, material_lots, updated_at,
      rows:production_plan_rows ( id, customer_id, label, is_reserve, delivery_date, delivery_note, order_ids, sort_order,
        customer:customers ( name ),
        quantities:production_plan_quantities ( product_id, quantity ) )`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const plan = data as unknown as Omit<ProductionPlan, 'rows'> & {
    rows: (Omit<PlanRow, 'quantities' | 'customer_name'> & { customer: { name: string | null } | null; quantities: { product_id: string; quantity: number | string }[] })[];
  };
  return {
    ...plan,
    material_lots: Array.isArray(plan.material_lots) ? plan.material_lots : [],
    rows: plan.rows
      .map(({ customer, quantities, ...row }) => ({
        ...row,
        customer_name: customer?.name ?? null,
        quantities: Object.fromEntries(quantities.map((q) => [q.product_id, Number(q.quantity)])),
      }))
      // The reserve last, as on the sheet.
      .sort((a, b) => Number(a.is_reserve) - Number(b.is_reserve) || a.sort_order - b.sort_order || (a.delivery_date ?? '').localeCompare(b.delivery_date ?? '')),
  };
}

/**
 * The orders a plan covers: delivering from the plan day until the day before
 * the line's next plan — or a week, while there is no next plan yet. Not
 * cancelled ones.
 */
export async function getOrdersForPlan(lineId: string, planDate: string): Promise<{ until: string; orders: OrderForPlan[] }> {
  const supabase = createClient();
  const { data: next } = await supabase
    .from('production_plans')
    .select('plan_date')
    .eq('line_id', lineId)
    .gt('plan_date', planDate)
    .order('plan_date')
    .limit(1)
    .maybeSingle();
  const until = next ? addDays((next as { plan_date: string }).plan_date, -1) : addDays(planDate, 6);

  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_id, delivery_date, delivery_method:delivery_methods ( name ), lines:order_lines ( product_id, ordered_quantity )')
    .neq('status', 'cancelled')
    .gte('delivery_date', planDate)
    .lte('delivery_date', until)
    .order('delivery_date');
  if (error) throw new Error(error.message);
  const orders = (data ?? []).map((r) => {
    const o = r as unknown as {
      id: string; customer_id: string; delivery_date: string;
      delivery_method: { name: string } | null;
      lines: { product_id: string; ordered_quantity: number | string }[];
    };
    return {
      id: o.id,
      customer_id: o.customer_id,
      delivery_date: o.delivery_date,
      delivery_note: o.delivery_method?.name ?? null,
      lines: o.lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.ordered_quantity) })),
    };
  });
  return { until, orders };
}

/** The Materia Prima items, in the list's order: what a plan can carry a lot for. */
export async function getRawMaterials(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('inventory_template_items')
    .select('id, name, template:inventory_templates!inner ( slug )')
    .eq('template.slug', 'materia-prima')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: (r as { id: string }).id, name: (r as { name: string }).name }));
}

/**
 * Each raw material's lots, from the latest completed Materia Prima count
 * that wrote one for it (latestLots). A year back is plenty.
 */
export async function getMaterialLots(today: string): Promise<Record<string, { lot: string; quantity: number; counted_on: string }[]>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('inventory_entries')
    // Entries reach their count through the count's item.
    .select('lot_number, quantity, item:inventory_instance_items!inner ( template_item_id, instance:inventory_instances!inner ( inventory_date, status, template:inventory_templates!inner ( slug ) ) )')
    .eq('item.instance.template.slug', 'materia-prima')
    .eq('item.instance.status', 'completed')
    .gte('item.instance.inventory_date', addDays(today, -365))
    .not('lot_number', 'is', null);
  if (error) throw new Error(error.message);
  return latestLots(
    (data ?? []).map((r) => {
      const e = r as unknown as { lot_number: string | null; quantity: number | null; item: { template_item_id: string; instance: { inventory_date: string } } };
      return { item_id: e.item.template_item_id, counted_on: e.item.instance.inventory_date, lot: e.lot_number, quantity: e.quantity };
    }),
  );
}
