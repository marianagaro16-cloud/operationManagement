'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isValidSchedule } from '@/domain/orders/scheduling';
import type { ActionResult } from './actions';

/**
 * Orders mutations.
 *
 * Admin-only writes go straight to the tables and are gated by RLS. The one
 * thing a USER may write on an order line — the shortfall reason — goes
 * through a SECURITY DEFINER RPC, because RLS cannot express column-level
 * permission. Lot allocations are written directly: the over-allocation
 * trigger and CHECK constraints already enforce every rule server-side.
 */

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('over_allocation')) return { ok: false, error: 'over_allocation' };
  if (message.includes('reason_required')) return { ok: false, error: 'reason_required' };
  if (message.includes('not_authorized')) return { ok: false, error: 'not_authorized' };
  if (message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: message };
}

function revalidateOrders() {
  revalidatePath('/orders');
  revalidatePath('/preparation');
  revalidatePath('/dashboard');
}

/* ------------------------------- orders -------------------------------- */

const orderInputSchema = z.object({
  customer_id: z.string().uuid(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // "HH:MM" from an <input type="time">. Optional as well as nullable: an
  // omitted key means "no hour committed", so a caller that predates the
  // field (a browser tab cached from an earlier deploy, for instance) still
  // saves successfully instead of failing validation.
  delivery_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  preparation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  delivery_method_id: z.string().uuid().nullable(),
  status: z.enum(['draft', 'confirmed', 'cancelled']),
  order_type: z.enum(['sale', 'sample']),
  note: z.string().trim().nullable(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        product_id: z.string().uuid(),
        ordered_quantity: z.number().positive(),
        note: z.string().trim().nullable().optional(),
      }),
    )
    .min(1),
});

export type OrderInput = z.infer<typeof orderInputSchema>;

export async function saveOrder(
  input: OrderInput,
  orderId?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = orderInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const data = parsed.data;

  // An order carries exactly one delivery date; preparation cannot follow it.
  if (!isValidSchedule(data.delivery_date, data.preparation_date)) {
    return { ok: false, error: 'preparation_after_delivery' };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  // Inactive customers and products may not be used on NEW orders, but
  // historical orders keep displaying them.
  const { data: customer } = await supabase
    .from('customers').select('is_active').eq('id', data.customer_id).maybeSingle();
  if (!customer) return { ok: false, error: 'customer_not_found' };
  if (!customer.is_active && !orderId) return { ok: false, error: 'customer_inactive' };

  const productIds = [...new Set(data.lines.map((l) => l.product_id))];
  const { data: products } = await supabase
    .from('products').select('id, is_active').in('id', productIds);
  if ((products?.length ?? 0) !== productIds.length) return { ok: false, error: 'product_not_found' };

  const header = {
    customer_id: data.customer_id,
    delivery_date: data.delivery_date,
    delivery_time: data.delivery_time ?? null,
    preparation_date: data.preparation_date,
    delivery_method_id: data.delivery_method_id,
    status: data.status,
    order_type: data.order_type,
    note: data.note,
    updated_by: user.id,
  };

  let id = orderId;
  if (id) {
    const { error } = await supabase.from('orders').update(header).eq('id', id);
    if (error) return fail(error);
  } else {
    // Only block inactive products when they are newly introduced.
    if (products?.some((p) => !p.is_active)) return { ok: false, error: 'product_inactive' };
    const { data: created, error } = await supabase
      .from('orders')
      .insert({ ...header, created_by: user.id })
      .select('id')
      .single();
    if (error) return fail(error);
    id = (created as { id: string }).id;
  }

  // Reconcile lines. Removing a line cascades its allocations, so lines that
  // carry preparation history are only deleted when the admin truly drops
  // them from the order.
  const { data: existing } = await supabase.from('order_lines').select('id').eq('order_id', id);
  const keep = new Set(data.lines.map((l) => l.id).filter(Boolean) as string[]);
  const toDelete = (existing ?? []).map((l) => l.id).filter((x) => !keep.has(x));
  if (toDelete.length) {
    const { error } = await supabase.from('order_lines').delete().in('id', toDelete);
    if (error) return fail(error);
  }

  for (const [i, line] of data.lines.entries()) {
    const row = {
      order_id: id,
      product_id: line.product_id,
      ordered_quantity: line.ordered_quantity,
      note: line.note ?? null,
      position: i,
    };
    const { error } = line.id
      ? await supabase.from('order_lines').update(row).eq('id', line.id)
      : await supabase.from('order_lines').insert(row);
    if (error) return fail(error);
  }

  revalidateOrders();
  return { ok: true, data: { id: id as string } };
}

export async function setOrderStatus(
  orderId: string,
  status: 'draft' | 'confirmed' | 'cancelled',
): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('orders')
    .update({ status, updated_by: user?.id ?? null })
    .eq('id', orderId);
  if (error) return fail(error);
  revalidateOrders();
  return { ok: true, data: undefined };
}

/* --------------------------- lot allocations ---------------------------- */

const allocationSchema = z.object({
  order_line_id: z.string().uuid(),
  lot_number: z.string().trim().min(1),
  quantity: z.number().positive(),
  note: z.string().trim().nullable().optional(),
});

/** The main USER action. Customer/product/quantity are never re-entered. */
export async function saveLotAllocation(
  input: z.infer<typeof allocationSchema>,
  allocationId?: string,
): Promise<ActionResult> {
  const parsed = allocationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_allocation' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const row = {
    order_line_id: parsed.data.order_line_id,
    lot_number: parsed.data.lot_number,
    quantity: parsed.data.quantity,
    note: parsed.data.note ?? null,
    updated_by: user.id,
  };

  // The database trigger is what actually blocks over-allocation.
  const { error } = allocationId
    ? await supabase.from('lot_allocations').update(row).eq('id', allocationId)
    : await supabase.from('lot_allocations').insert({ ...row, created_by: user.id });

  if (error) return fail(error);
  revalidateOrders();
  return { ok: true, data: undefined };
}

export async function deleteLotAllocation(allocationId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('lot_allocations').delete().eq('id', allocationId);
  if (error) return fail(error);
  revalidateOrders();
  return { ok: true, data: undefined };
}

/** A user may explain a shortfall but change nothing else on the line. */
export async function setShortfallReason(
  orderLineId: string,
  reason: string,
): Promise<ActionResult> {
  if (!reason.trim()) return { ok: false, error: 'reason_required' };
  const supabase = createClient();
  const { error } = await supabase.rpc('set_line_shortfall_reason', {
    p_order_line_id: orderLineId,
    p_reason: reason.trim(),
  });
  if (error) return fail(error);
  revalidateOrders();
  return { ok: true, data: undefined };
}

/* ------------------------------ master data ----------------------------- */

export async function saveCustomer(
  name: string,
  isActive: boolean,
  id?: string,
): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, error: 'name_required' };
  const supabase = createClient();
  const row = { name: name.trim(), is_active: isActive };
  const { error } = id
    ? await supabase.from('customers').update(row).eq('id', id)
    : await supabase.from('customers').insert(row);
  if (error) return fail(error);
  revalidatePath('/admin/customers');
  return { ok: true, data: undefined };
}

const productSchema = z.object({
  code: z.string().trim().nullable(),
  family: z.string().trim().min(1),
  presentation: z.string().trim().min(1),
  category: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  is_active: z.boolean(),
  needs_review: z.boolean(),
});

export async function saveProduct(
  input: z.infer<typeof productSchema>,
  id?: string,
): Promise<ActionResult> {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_product' };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('products').update(parsed.data).eq('id', id)
    : await supabase.from('products').insert(parsed.data);
  if (error) return fail(error);
  revalidatePath('/admin/products');
  return { ok: true, data: undefined };
}

export async function saveDeliveryMethod(
  name: string,
  slug: string,
  isActive: boolean,
  id?: string,
): Promise<ActionResult> {
  if (!name.trim() || !slug.trim()) return { ok: false, error: 'name_required' };
  const supabase = createClient();
  const row = { name: name.trim(), slug: slug.trim().toLowerCase(), is_active: isActive };
  const { error } = id
    ? await supabase.from('delivery_methods').update(row).eq('id', id)
    : await supabase.from('delivery_methods').insert(row);
  if (error) return fail(error);
  revalidatePath('/admin/delivery-methods');
  return { ok: true, data: undefined };
}

/* --------------------------- recurring templates ------------------------ */

export async function setTemplateActive(id: string, isActive: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from('recurring_order_templates')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) return fail(error);
  revalidatePath('/admin/recurring');
  return { ok: true, data: undefined };
}

export async function saveTemplate(
  input: {
    customer_id: string;
    delivery_weekday: number;
    preparation_lead_days: number;
    delivery_method_id: string | null;
    order_type: 'sale' | 'sample';
    note: string | null;
    is_active: boolean;
    lines: { product_id: string; default_quantity: number }[];
  },
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();
  const header = {
    customer_id: input.customer_id,
    delivery_weekday: input.delivery_weekday,
    preparation_lead_days: input.preparation_lead_days,
    delivery_method_id: input.delivery_method_id,
    order_type: input.order_type,
    note: input.note,
    is_active: input.is_active,
  };

  let templateId = id;
  if (templateId) {
    const { error } = await supabase.from('recurring_order_templates').update(header).eq('id', templateId);
    if (error) return fail(error);
    await supabase.from('recurring_order_template_lines').delete().eq('template_id', templateId);
  } else {
    const { data, error } = await supabase
      .from('recurring_order_templates').insert(header).select('id').single();
    if (error) return fail(error);
    templateId = (data as { id: string }).id;
  }

  if (input.lines.length) {
    const { error } = await supabase.from('recurring_order_template_lines').insert(
      input.lines.map((l, i) => ({
        template_id: templateId,
        product_id: l.product_id,
        default_quantity: l.default_quantity,
        position: i,
      })),
    );
    if (error) return fail(error);
  }

  revalidatePath('/admin/recurring');
  return { ok: true, data: { id: templateId as string } };
}

/**
 * Materialise a DRAFT order from a template for admin review.
 * Never produces a confirmed order.
 */
export async function generateOrderFromTemplate(
  templateId: string,
  deliveryDate: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('generate_order_from_template', {
    p_template_id: templateId,
    p_delivery_date: deliveryDate,
  });
  if (error) return fail(error);
  revalidateOrders();
  return { ok: true, data: { id: (data as { id: string }).id } };
}
