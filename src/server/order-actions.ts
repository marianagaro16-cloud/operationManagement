'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isValidSchedule } from '@/domain/orders/scheduling';
import { getViewer } from './data';
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
  // NOT NULL in the database. Validated here as well so a missing method is
  // a translatable refusal rather than a constraint violation surfaced raw.
  delivery_method_id: z.string().uuid(),
  status: z.enum(['draft', 'confirmed', 'cancelled']),
  order_type: z.enum(['sale', 'sample', 'replacement']),
  note: z.string().trim().nullable(),
  /**
   * How the order arrived. Omitted means what it has always meant — entered
   * by hand — so a caller that predates the importer still saves.
   */
  import_source: z.enum(['excel', 'email']).nullable().optional(),
  /**
   * One key per import session, minted by the client.
   *
   * The unique index on orders.import_key is what actually prevents a double
   * submission from becoming two real orders; this carries the value to it.
   */
  import_key: z.string().trim().min(8).max(100).nullable().optional(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        product_id: z.string().uuid(),
        ordered_quantity: z.number().positive(),
        note: z.string().trim().nullable().optional(),
        /** Verbatim customer text this line came from. Traceability only. */
        source_text: z.string().trim().max(500).nullable().optional(),
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

    // An import that is submitted twice — a double tap, a retried request on a
    // flaky warehouse connection — must not become two deliveries. The second
    // insert collides with the partial unique index on import_key, and the
    // order that already exists is returned as the successful result, because
    // from the user's side it IS the successful result.
    const { data: created, error } = await supabase
      .from('orders')
      .insert({
        ...header,
        import_source: data.import_source ?? null,
        import_key: data.import_key ?? null,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error) {
      if (data.import_key && error.message.includes('orders_import_key_key')) {
        const { data: existing } = await supabase
          .from('orders')
          .select('id, lines:order_lines ( id )')
          .eq('import_key', data.import_key)
          .maybeSingle();
        if (!existing) return fail(error);

        const found = existing as { id: string; lines: { id: string }[] | null };
        // The order already has its products, so the earlier submission got
        // all the way through and this one is the duplicate it was meant to
        // stop. Return what exists; touching it again could only undo work.
        if ((found.lines ?? []).length > 0) return { ok: true, data: { id: found.id } };

        // The header landed and the lines did not — the earlier attempt died
        // between the two writes, which are not one transaction. Adopting the
        // id and carrying on FINISHES that order instead of reporting success
        // on an empty one. Safe because an order with no lines has no
        // preparation history to lose.
        id = found.id;
      } else {
        return fail(error);
      }
    } else {
      id = (created as { id: string }).id;
    }
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
      // source_text is written once, on the line's creation. An edit must not
      // clear it — the text the customer sent does not change because somebody
      // corrected the quantity — and must not overwrite it either.
      : await supabase.from('order_lines').insert({ ...row, source_text: line.source_text ?? null });
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

const customerSchema = z.object({
  company_name: z.string().trim().min(1),
  // Kept separate from the company name on purpose; never merged away.
  company_name_addition: z.string().trim().nullable(),
  /** Commercial segment, or null while unclassified. Optional so an older
   *  caller that never sent it does not silently wipe an existing one. */
  customer_type_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean(),
});

export async function saveCustomer(
  input: z.infer<typeof customerSchema>,
  id?: string,
): Promise<ActionResult> {
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'name_required' };
  const supabase = createClient();
  // `name` is a generated column — derived by Postgres, never written here.
  const row = {
    company_name: parsed.data.company_name,
    company_name_addition: parsed.data.company_name_addition || null,
    // undefined leaves the column alone; null clears it deliberately.
    ...(parsed.data.customer_type_id === undefined
      ? {}
      : { customer_type_id: parsed.data.customer_type_id }),
    is_active: parsed.data.is_active,
  };
  const { error } = id
    ? await supabase.from('customers').update(row).eq('id', id)
    : await supabase.from('customers').insert(row);
  if (error) return fail(error);
  revalidatePath('/admin/customers');
  return { ok: true, data: undefined };
}

/**
 * Classify one customer, without opening the edit dialog.
 *
 * 221 customers arrived unclassified when the segment was introduced, and
 * working through that backlog through a modal per customer is the kind of
 * chore nobody finishes. This is the same write saveCustomer performs,
 * reached from a dropdown in the list row.
 *
 * Deliberately does NOT touch any other column: classifying is not editing,
 * and a fast control that quietly re-saved the name would be a trap.
 */
export async function setCustomerType(
  customerId: string,
  customerTypeId: string | null,
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(customerId).success) return { ok: false, error: 'name_required' };
  if (customerTypeId !== null && !z.string().uuid().safeParse(customerTypeId).success) {
    return { ok: false, error: 'name_required' };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('customers')
    .update({ customer_type_id: customerTypeId })
    .eq('id', customerId);

  if (error) return fail(error);
  revalidatePath('/admin/customers');
  return { ok: true, data: undefined };
}

const productSchema = z.object({
  code: z.string().trim().nullable(),
  // Stored verbatim. Never parsed into category, weight, size or packaging.
  name: z.string().trim().min(1),
  family: z.string().trim().min(1),
  presentation: z.string().trim().min(1),
  category: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  /**
   * Order units per shipping box. NULL means the conversion is unknown, and
   * the importer must then ask rather than assume — so an empty field here is
   * a meaningful answer, not a missing one.
   */
  units_per_box: z.number().positive().nullable().optional(),
  /** One of our brands, or null while the product is unclassified. */
  brand_id: z.string().uuid().nullable().optional(),
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
  // An omitted units_per_box means "not stated"; an explicit null means "no
  // reliable conversion exists". Both store NULL, which is the honest value.
  const row = {
    ...parsed.data,
    units_per_box: parsed.data.units_per_box ?? null,
    brand_id: parsed.data.brand_id ?? null,
  };
  const { error } = id
    ? await supabase.from('products').update(row).eq('id', id)
    : await supabase.from('products').insert(row);
  if (error) return fail(error);
  revalidatePath('/admin/products');
  return { ok: true, data: undefined };
}

/**
 * A brand.
 *
 * Never deleted — the products table references it with ON DELETE RESTRICT,
 * so retiring one is a matter of clearing is_active while every product that
 * names it goes on naming it.
 */
export async function saveBrand(
  name: string,
  isActive: boolean,
  id?: string,
): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, error: 'name_required' };
  const supabase = createClient();
  const row = { name: name.trim(), is_active: isActive };
  const { error } = id
    ? await supabase.from('brands').update(row).eq('id', id)
    : await supabase.from('brands').insert(row);
  if (error) return fail(error);
  revalidatePath('/admin/brands');
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

/** A uuid, or nothing. Used where a missing id must be a message, not a throw. */
function parsedUuid(value: string | null | undefined): boolean {
  return z.string().uuid().safeParse(value).success;
}

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
    interval_weeks: number;
    anchor_date: string | null;
    preparation_lead_days: number;
    delivery_method_id: string;
    order_type: 'sale' | 'sample' | 'replacement';
    note: string | null;
    is_active: boolean;
    lines: { product_id: string; default_quantity: number }[];
  },
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  /*
   * A standing order with no delivery method cannot produce an order — the
   * column is NOT NULL on both tables since
   * 20260926090000_delivery_method_required. Refused here so the caller gets
   * a translatable message; refused again by the database, which is what
   * makes it true. saveTemplate had no runtime validation at all, so a stale
   * browser tab posting the old shape would have surfaced a raw constraint
   * violation.
   */
  if (!parsedUuid(input.delivery_method_id)) {
    return { ok: false, error: 'delivery_method_required' };
  }

  const supabase = createClient();
  const header = {
    customer_id: input.customer_id,
    delivery_weekday: input.delivery_weekday,
    interval_weeks: input.interval_weeks,
    // Cleared at interval 1, where it means nothing and would only mislead
    // whoever read the row later. The CHECK constraint requires it above 1.
    anchor_date: input.interval_weeks > 1 ? input.anchor_date : null,
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
  // A template change alters what tomorrow's drafts will contain, and the
  // order book is where anybody would look for the consequence.
  revalidatePath('/orders');
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

/* ------------------------ customer specifications ----------------------- */

const specificationSchema = z.object({
  customer_id: z.string().uuid(),
  type_id: z.string().uuid(),
  body: z.string().trim().min(1).max(1000),
  is_active: z.boolean(),
});

/**
 * Record or correct a standing reminder for a customer.
 *
 * The capability check is customers.manage, which Manager and Power User hold
 * and a plain user does not — the line asked for, expressed with a key that
 * already means "may look after customer master data" rather than a new one
 * invented for four reminders. RLS enforces the same rule on the table, so
 * this check exists to produce a message rather than to be the boundary.
 */
export async function saveCustomerSpecification(
  input: z.infer<typeof specificationSchema>,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = specificationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'specification_incomplete' };

  const viewer = await getViewer();
  if (!viewer?.can('customers.manage')) return { ok: false, error: 'not_authorized' };

  const supabase = createClient();
  const row = { ...parsed.data, updated_by: viewer.profile.id };

  if (id) {
    const { error } = await supabase.from('customer_specifications').update(row).eq('id', id);
    if (error) return fail(error);
    revalidatePath('/admin/specifications');
    return { ok: true, data: { id } };
  }

  const { data, error } = await supabase
    .from('customer_specifications')
    .insert({ ...row, created_by: viewer.profile.id })
    .select('id')
    .single();

  if (error) return fail(error);
  revalidatePath('/admin/specifications');
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/**
 * Retire a reminder, or bring it back.
 *
 * Never a delete: "we used to invoice them monthly" is a real answer to a
 * question about an old invoice, and deleting the reminder deletes the answer.
 */
export async function setSpecificationActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer?.can('customers.manage')) return { ok: false, error: 'not_authorized' };

  const supabase = createClient();
  const { error } = await supabase
    .from('customer_specifications')
    .update({ is_active: isActive, updated_by: viewer.profile.id })
    .eq('id', id);

  if (error) return fail(error);
  revalidatePath('/admin/specifications');
  return { ok: true, data: undefined };
}
