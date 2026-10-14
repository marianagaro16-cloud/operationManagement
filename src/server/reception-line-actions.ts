'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { LINE_UNITS } from '@/domain/goods-reception/expected';
import type { ActionResult } from './actions';

/*
 * What arrived on a reception: product lines with quantity and best-before
 * (decided 2026-10-14). Optional. Written by whoever may write the reception,
 * and by the office at any time — can_write_reception_lines() decides.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

const lineSchema = z
  .object({
    id: z.string().uuid().optional(),
    reception_id: z.string().uuid(),
    product_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
    description: text(200),
    quantity: z.number().positive().max(1_000_000).nullable().optional().transform((v) => v ?? null),
    unit: z.enum(LINE_UNITS).default('units'),
    best_before: DATE.nullable().optional().transform((v) => v ?? null),
    lot_number: text(80),
    note: text(500),
  })
  .refine((l) => (l.product_id !== null) !== (l.description !== null), { message: 'product_or_text' });

function fail(message: string): { ok: false; error: string } {
  if (message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: message };
}

function revalidate(receptionId: string) {
  revalidatePath(`/goods-reception/${receptionId}`);
  revalidatePath('/goods-reception');
}

export async function saveReceptionLine(input: z.input<typeof lineSchema>): Promise<ActionResult> {
  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_line' };
  const { id, ...row } = parsed.data;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  if (id) {
    const { reception_id, ...fields } = row;
    const { error } = await supabase
      .from('goods_reception_lines')
      .update({ ...fields, updated_by: user.id })
      .eq('id', id)
      .eq('reception_id', reception_id);
    if (error) return fail(error.message);
  } else {
    const { count } = await supabase
      .from('goods_reception_lines')
      .select('id', { count: 'exact', head: true })
      .eq('reception_id', row.reception_id);
    const { error } = await supabase
      .from('goods_reception_lines')
      .insert({ ...row, sort_order: count ?? 0, created_by: user.id, updated_by: user.id });
    if (error) return fail(error.message);
  }
  revalidate(row.reception_id);
  return { ok: true, data: undefined };
}

export async function deleteReceptionLine(id: string, receptionId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('goods_reception_lines').delete().eq('id', id).eq('reception_id', receptionId);
  if (error) return fail(error.message);
  revalidate(receptionId);
  return { ok: true, data: undefined };
}

/**
 * The announced lines of the expected delivery this reception closed, as
 * lines of what arrived — with what was counted where it was. The receiver
 * then only adds the dates.
 */
export async function copyExpectedLines(receptionId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const { data: expected } = await supabase
    .from('expected_deliveries')
    .select('lines:expected_delivery_lines ( product_id, description, quantity, received_quantity, unit, sort_order )')
    .eq('reception_id', receptionId)
    .maybeSingle();
  const lines = ((expected?.lines ?? []) as {
    product_id: string | null; description: string | null; quantity: number | string;
    received_quantity: number | string | null; unit: string; sort_order: number;
  }[]).sort((a, b) => a.sort_order - b.sort_order);
  if (lines.length === 0) return { ok: false, error: 'no_expected_lines' };

  const { count } = await supabase
    .from('goods_reception_lines')
    .select('id', { count: 'exact', head: true })
    .eq('reception_id', receptionId);
  const start = count ?? 0;

  const { error } = await supabase.from('goods_reception_lines').insert(
    lines.map((l, i) => ({
      reception_id: receptionId,
      product_id: l.product_id,
      description: l.product_id ? null : l.description,
      quantity: Number(l.received_quantity ?? l.quantity) > 0 ? Number(l.received_quantity ?? l.quantity) : null,
      unit: l.unit,
      sort_order: start + i,
      created_by: user.id,
      updated_by: user.id,
    })),
  );
  if (error) return fail(error.message);
  revalidate(receptionId);
  return { ok: true, data: undefined };
}
