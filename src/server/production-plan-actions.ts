'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rowsFromOrders } from '@/domain/production-plan/plan';
import { getViewer } from './data';
import { getOrdersForPlan } from './production-plans';
import type { ActionResult } from './actions';

/*
 * Production plans: whoever holds production_plans.manage (Admin, Owners, and
 * someone given it with a coverage period). RLS (can_plan_production) is what
 * enforces it; these validate, translate refusals and refresh the screens.
 */

function fail(error: { message?: string; code?: string } | string): { ok: false; error: string } {
  if (typeof error === 'string') return { ok: false, error };
  if (error.code === '23505') return { ok: false, error: 'plan_exists' };
  if (error.message?.includes('row-level security') || error.code === '42501') return { ok: false, error: 'not_authorized' };
  return { ok: false, error: error.message ?? 'unknown' };
}

async function planner(): Promise<string | null> {
  const viewer = await getViewer();
  return viewer?.can('production_plans.manage') ? viewer.profile.id : null;
}

function refresh(planId?: string) {
  revalidatePath('/production-plans');
  if (planId) revalidatePath(`/production-plans/${planId}`);
}

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Adds the plan's not-yet-included orders as rows. */
async function addOrderRows(planId: string): Promise<ActionResult<{ added: number }>> {
  const supabase = createClient();
  const { data: plan, error } = await supabase
    .from('production_plans')
    .select('line_id, plan_date, rows:production_plan_rows ( order_ids, sort_order )')
    .eq('id', planId)
    .single();
  if (error) return fail(error);
  const p = plan as unknown as { line_id: string; plan_date: string; rows: { order_ids: string[]; sort_order: number }[] };

  const { data: lineProducts, error: lpError } = await supabase.from('production_line_products').select('product_id').eq('line_id', p.line_id);
  if (lpError) return fail(lpError);
  const { orders } = await getOrdersForPlan(p.line_id, p.plan_date);
  const rows = rowsFromOrders(
    orders,
    new Set((lineProducts ?? []).map((r) => (r as { product_id: string }).product_id)),
    new Set(p.rows.flatMap((r) => r.order_ids)),
  );
  let sort = Math.max(0, ...p.rows.map((r) => r.sort_order));
  for (const row of rows) {
    sort += 10;
    const { data: inserted, error: rowError } = await supabase
      .from('production_plan_rows')
      .insert({ plan_id: planId, customer_id: row.customer_id, delivery_date: row.delivery_date, delivery_note: row.delivery_note, order_ids: row.order_ids, sort_order: sort })
      .select('id')
      .single();
    if (rowError) return fail(rowError);
    const { error: qError } = await supabase
      .from('production_plan_quantities')
      .insert(Object.entries(row.quantities).map(([product_id, quantity]) => ({ row_id: inserted.id, product_id, quantity })));
    if (qError) return fail(qError);
  }
  return { ok: true, data: { added: rows.length } };
}

/** A new plan for a line and day: the reserve row, and the orders it covers. */
export async function createProductionPlan(input: { line_id: string; plan_date: string }): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(input.line_id).success || !date.safeParse(input.plan_date).success) return fail('invalid');
  const me = await planner();
  if (!me) return fail('not_authorized');
  const supabase = createClient();
  const { data, error } = await supabase
    .from('production_plans')
    .insert({ line_id: input.line_id, plan_date: input.plan_date, created_by: me, updated_by: me })
    .select('id')
    .single();
  if (error) return fail(error);
  const { error: reserveError } = await supabase.from('production_plan_rows').insert({ plan_id: data.id, is_reserve: true, sort_order: 100000 });
  if (reserveError) return fail(reserveError);
  const added = await addOrderRows(data.id);
  if (!added.ok) return added;
  refresh(data.id);
  return { ok: true, data: { id: data.id } };
}

/** Brings in orders placed since: only the ones not in the plan yet. */
export async function importPlanOrders(planId: string): Promise<ActionResult<{ added: number }>> {
  if (!uuid.safeParse(planId).success) return fail('invalid');
  if (!(await planner())) return fail('not_authorized');
  const res = await addOrderRows(planId);
  if (res.ok) refresh(planId);
  return res;
}

const rowSchema = z.object({
  customer_id: uuid.nullable(),
  label: z.string().trim().max(200).nullable(),
  delivery_date: date.nullable(),
  delivery_note: z.string().trim().max(100).nullable(),
});

export async function addPlanRow(planId: string, input: z.input<typeof rowSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = rowSchema.safeParse(input);
  if (!uuid.safeParse(planId).success || !parsed.success) return fail('invalid');
  if (!parsed.data.customer_id && !parsed.data.label) return fail('row_needs_name');
  if (!(await planner())) return fail('not_authorized');
  const supabase = createClient();
  const { data: last } = await supabase
    .from('production_plan_rows')
    .select('sort_order')
    .eq('plan_id', planId)
    .eq('is_reserve', false)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from('production_plan_rows')
    .insert({ plan_id: planId, ...parsed.data, label: parsed.data.label || null, delivery_note: parsed.data.delivery_note || null, sort_order: ((last as { sort_order: number } | null)?.sort_order ?? 0) + 10 })
    .select('id')
    .single();
  if (error) return fail(error);
  refresh(planId);
  return { ok: true, data: { id: data.id } };
}

export async function updatePlanRow(planId: string, rowId: string, input: z.input<typeof rowSchema>): Promise<ActionResult> {
  const parsed = rowSchema.safeParse(input);
  if (!uuid.safeParse(rowId).success || !parsed.success) return fail('invalid');
  if (!(await planner())) return fail('not_authorized');
  const supabase = createClient();
  const { error } = await supabase
    .from('production_plan_rows')
    .update({ ...parsed.data, label: parsed.data.label || null, delivery_note: parsed.data.delivery_note || null })
    .eq('id', rowId)
    .eq('is_reserve', false);
  if (error) return fail(error);
  refresh(planId);
  return { ok: true, data: undefined };
}

export async function deletePlanRow(planId: string, rowId: string): Promise<ActionResult> {
  if (!uuid.safeParse(rowId).success) return fail('invalid');
  if (!(await planner())) return fail('not_authorized');
  const supabase = createClient();
  const { error } = await supabase.from('production_plan_rows').delete().eq('id', rowId).eq('is_reserve', false);
  if (error) return fail(error);
  refresh(planId);
  return { ok: true, data: undefined };
}

/** One cell: units of a product on a row. Empty or 0 clears it. */
export async function setPlanQuantity(planId: string, rowId: string, productId: string, quantity: number | null): Promise<ActionResult> {
  if (!uuid.safeParse(rowId).success || !uuid.safeParse(productId).success) return fail('invalid');
  if (quantity != null && (!Number.isFinite(quantity) || quantity < 0 || quantity > 100000)) return fail('invalid');
  const me = await planner();
  if (!me) return fail('not_authorized');
  const supabase = createClient();
  const { error } = quantity
    ? await supabase.from('production_plan_quantities').upsert({ row_id: rowId, product_id: productId, quantity }, { onConflict: 'row_id,product_id' })
    : await supabase.from('production_plan_quantities').delete().eq('row_id', rowId).eq('product_id', productId);
  if (error) return fail(error);
  await supabase.from('production_plans').update({ updated_by: me, updated_at: new Date().toISOString() }).eq('id', planId);
  refresh(planId);
  return { ok: true, data: undefined };
}

const detailsSchema = z.object({
  notes: z.string().trim().max(4000).nullable(),
  corn_lots: z.array(z.object({ corn: z.string().trim().max(100), lot: z.string().trim().max(60) })).max(10),
});

export async function savePlanDetails(planId: string, input: z.input<typeof detailsSchema>): Promise<ActionResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!uuid.safeParse(planId).success || !parsed.success) return fail('invalid');
  const me = await planner();
  if (!me) return fail('not_authorized');
  const supabase = createClient();
  const { error } = await supabase
    .from('production_plans')
    .update({
      notes: parsed.data.notes || null,
      corn_lots: parsed.data.corn_lots.filter((c) => c.corn || c.lot),
      updated_by: me,
      updated_at: new Date().toISOString(),
    })
    .eq('id', planId);
  if (error) return fail(error);
  refresh(planId);
  return { ok: true, data: undefined };
}

export async function deleteProductionPlan(planId: string): Promise<ActionResult> {
  if (!uuid.safeParse(planId).success) return fail('invalid');
  if (!(await planner())) return fail('not_authorized');
  const supabase = createClient();
  const { error } = await supabase.from('production_plans').delete().eq('id', planId);
  if (error) return fail(error);
  refresh();
  return { ok: true, data: undefined };
}

// ---------- lines ----------

const factor = (max: number) => z.number().min(0).max(max);
const lineSchema = z.object({
  pure_share: z.number().gt(0).max(1),
  waste: factor(2),
  masa_per_grain_kg: z.number().gt(0).max(10),
  sack_kg: z.number().gt(0).max(100),
  totopo_factor: z.number().gt(0).max(10),
  evaporation: factor(2).nullable(),
  flour_factor: factor(2).nullable(),
  water_factor: factor(2).nullable(),
  salt_factor: factor(1).nullable(),
  standing_notes: z.string().trim().max(2000).nullable(),
});

export async function saveProductionLine(lineId: string, input: z.input<typeof lineSchema>): Promise<ActionResult> {
  const parsed = lineSchema.safeParse(input);
  if (!uuid.safeParse(lineId).success || !parsed.success) return fail('invalid');
  if (!(await planner())) return fail('not_authorized');
  const supabase = createClient();
  const { error } = await supabase
    .from('production_lines')
    .update({ ...parsed.data, standing_notes: parsed.data.standing_notes || null, updated_at: new Date().toISOString() })
    .eq('id', lineId);
  if (error) return fail(error);
  refresh();
  revalidatePath('/production-plans/settings');
  return { ok: true, data: undefined };
}

const lineProductSchema = z.object({
  section: z.enum(['tortilla', 'masa', 'totopo', 'tostada']),
  group_label: z.string().trim().min(1).max(100),
  best_before_days: z.number().int().min(0).max(1000).nullable(),
  sort_order: z.number().int().min(0).max(100000),
});

export async function saveLineProduct(lineId: string, productId: string, input: z.input<typeof lineProductSchema>): Promise<ActionResult> {
  const parsed = lineProductSchema.safeParse(input);
  if (!uuid.safeParse(lineId).success || !uuid.safeParse(productId).success || !parsed.success) return fail('invalid');
  if (!(await planner())) return fail('not_authorized');
  const supabase = createClient();
  const { error } = await supabase
    .from('production_line_products')
    .upsert({ line_id: lineId, product_id: productId, ...parsed.data }, { onConflict: 'line_id,product_id' });
  if (error) return fail(error);
  revalidatePath('/production-plans/settings');
  refresh();
  return { ok: true, data: undefined };
}

/** Off the line's list. Plans that already counted it keep their numbers. */
export async function removeLineProduct(lineId: string, productId: string): Promise<ActionResult> {
  if (!uuid.safeParse(lineId).success || !uuid.safeParse(productId).success) return fail('invalid');
  if (!(await planner())) return fail('not_authorized');
  const supabase = createClient();
  const { error } = await supabase.from('production_line_products').delete().eq('line_id', lineId).eq('product_id', productId);
  if (error) return fail(error);
  revalidatePath('/production-plans/settings');
  refresh();
  return { ok: true, data: undefined };
}
