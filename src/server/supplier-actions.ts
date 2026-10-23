'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from './data';
import type { ActionResult } from './actions';

/*
 * Supplier details and who supplies each product: the office writes them
 * (RLS: is_office). These validate and translate refusals.
 */

const OFFICE = ['owner', 'admin', 'power_user'];

function fail(error: { message?: string; code?: string } | string): { ok: false; error: string } {
  if (typeof error === 'string') return { ok: false, error };
  if (error.message?.includes('row-level security') || error.code === '42501') return { ok: false, error: 'not_authorized' };
  if (error.message?.includes('_one_main')) return { ok: false, error: 'one_main' };
  return { ok: false, error: error.message ?? 'unknown' };
}

const text = (max: number) => z.string().trim().max(max).nullable();

const detailsSchema = z.object({
  contact_person: text(200),
  email: text(200),
  phone: text(60),
  mobile: text(60),
  website: text(300),
  street: text(300),
  postal_code: text(20),
  city: text(100),
  country: z.string().trim().length(2).nullable(),
  our_customer_no: text(60),
  order_days: z.array(z.number().int().min(1).max(7)).max(7).nullable(),
  lead_time_days: z.number().int().min(0).max(365).nullable(),
  vat_no: text(60),
  uid_no: text(60),
  iban: text(40),
  payment_terms: text(200),
  notes: text(4000),
});

export type SupplierDetailsInput = z.infer<typeof detailsSchema>;

/** A supplier's contact, address, ordering, tax and payment details. */
export async function saveSupplierDetails(supplierId: string, input: SupplierDetailsInput): Promise<ActionResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!z.string().uuid().safeParse(supplierId).success || !parsed.success) return fail('invalid');
  const viewer = await getViewer();
  if (!viewer || !OFFICE.includes(viewer.role)) return fail('not_authorized');

  // Empty is empty, not ''.
  const row = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v === '' || (Array.isArray(v) && v.length === 0) ? null : v]));
  const supabase = createClient();
  const { error } = await supabase
    .from('supplier_details')
    .upsert({ supplier_id: supplierId, ...row, updated_by: viewer.profile.id }, { onConflict: 'supplier_id' });
  if (error) return fail(error);
  revalidatePath('/admin/suppliers');
  return { ok: true, data: undefined };
}

const linksSchema = z
  .array(z.object({ supplier_id: z.string().uuid(), is_main: z.boolean(), supplier_code: text(60) }))
  .max(20)
  .refine((list) => list.filter((l) => l.is_main).length <= 1, 'one_main')
  .refine((list) => new Set(list.map((l) => l.supplier_id)).size === list.length, 'duplicate');

/** A product's or an inventory item's suppliers: the whole list, replaced. */
async function replaceLinks(
  table: 'product_suppliers' | 'inventory_item_suppliers',
  key: 'product_id' | 'item_id',
  id: string,
  links: z.input<typeof linksSchema>,
): Promise<ActionResult> {
  const parsed = linksSchema.safeParse(links);
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return fail('invalid');
  const viewer = await getViewer();
  if (!viewer || !OFFICE.includes(viewer.role)) return fail('not_authorized');

  const supabase = createClient();
  const { error: cleared } = await supabase.from(table).delete().eq(key, id);
  if (cleared) return fail(cleared);
  if (parsed.data.length > 0) {
    const { error } = await supabase
      .from(table)
      .insert(parsed.data.map((l) => ({ ...l, supplier_code: l.supplier_code || null, [key]: id })));
    if (error) return fail(error);
  }
  return { ok: true, data: undefined };
}

/** Who supplies a product. */
export async function saveProductSuppliers(productId: string, links: z.input<typeof linksSchema>): Promise<ActionResult> {
  const res = await replaceLinks('product_suppliers', 'product_id', productId, links);
  if (res.ok) revalidatePath('/admin/products');
  return res;
}

/** Who supplies a raw material or a packaging item. */
export async function saveItemSuppliers(itemId: string, links: z.input<typeof linksSchema>): Promise<ActionResult> {
  const res = await replaceLinks('inventory_item_suppliers', 'item_id', itemId, links);
  if (res.ok) revalidatePath('/admin/inventory', 'layout');
  return res;
}
