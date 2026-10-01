'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './actions';
import type { ProductionRecord } from '@/types/database';

/*
 * Production orders: recording what was made completes the day
 * (record_production). Who may is the database's: whoever may act on that
 * day of the activity, and whoever plans work.
 */

// A 'use server' file exports only async functions: the list stays here.
const SHORTFALL_REASONS = ['raw_material', 'packaging', 'time', 'damaged', 'other'] as const;

const schema = z.object({
  occurrence_id: z.string().uuid(),
  produced: z.number().min(0).max(1_000_000),
  lot: z.string().trim().max(80).nullable(),
  best_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  reason: z.enum(SHORTFALL_REASONS).nullable(),
  note: z.string().max(2000).nullable(),
});

const KNOWN = ['lot_required', 'reason_required', 'invalid_quantity', 'not_authorized', 'not_production', 'occurrence_not_found'];

export async function recordProduction(input: z.input<typeof schema>): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_quantity' };
  const v = parsed.data;
  const supabase = createClient();
  const { error } = await supabase.rpc('record_production', {
    p_occurrence_id: v.occurrence_id,
    p_produced: v.produced,
    p_lot: v.lot ?? '',
    p_best_before: v.best_before as string,
    p_reason: v.reason as string,
    p_note: v.note ?? '',
  });
  if (error) return { ok: false, error: KNOWN.find((k) => error.message.includes(k)) ?? error.message };
  revalidatePath('/dashboard');
  revalidatePath('/agenda');
  revalidatePath('/production');
  return { ok: true, data: undefined };
}

export interface ProductionContext {
  occurrence_id: string;
  product_name: string;
  target_quantity: number;
  due_date: string;
  record: ProductionRecord | null;
}

/** What the record dialog needs, for screens that only know the day's id (Agenda, cover). */
export async function getProductionContext(occurrenceId: string): Promise<ActionResult<ProductionContext>> {
  if (!z.string().uuid().safeParse(occurrenceId).success) return { ok: false, error: 'not_production' };
  const supabase = createClient();
  const { data } = await supabase
    .from('task_occurrences')
    .select(
      'id, effective_due_date, task:tasks!inner ( target_quantity, product:products ( name ) ), production:production_records ( produced_quantity, target_quantity, lot_number, best_before, shortfall_reason, shortfall_note )',
    )
    .eq('id', occurrenceId)
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    effective_due_date: string;
    task: { target_quantity: number | null; product: { name: string } | null };
    production: ProductionRecord | null;
  } | null;
  if (!row || row.task.target_quantity === null) return { ok: false, error: 'not_production' };
  return {
    ok: true,
    data: {
      occurrence_id: row.id,
      product_name: row.task.product?.name ?? '—',
      target_quantity: Number(row.task.target_quantity),
      due_date: row.effective_due_date,
      record: row.production,
    },
  };
}

/** Lots recently made of a product — offered when preparing an order. */
export async function getRecentLots(productId: string): Promise<{ lot_number: string; best_before: string | null }[]> {
  if (!z.string().uuid().safeParse(productId).success) return [];
  const supabase = createClient();
  const { data } = await supabase.rpc('recent_production_lots', { p_product_id: productId });
  return ((data ?? []) as { lot_number: string; best_before: string | null }[]).map(({ lot_number, best_before }) => ({ lot_number, best_before }));
}
