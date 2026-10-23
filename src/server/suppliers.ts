import 'server-only';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/*
 * Suppliers made complete (2026-10-23): their contact, address, ordering,
 * tax and payment details, and who supplies each product. The office only —
 * RLS (is_office) returns nothing to anyone else.
 */

export interface SupplierDetails {
  supplier_id: string;
  bexio_no: number | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  website: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  our_customer_no: string | null;
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  order_days: number[] | null;
  lead_time_days: number | null;
  vat_no: string | null;
  uid_no: string | null;
  iban: string | null;
  payment_terms: string | null;
  notes: string | null;
}

/** The Guías card: how to order. Edited in Guías; shown beside the details. */
export interface SupplierOrderCard {
  supplier_id: string;
  how: string | null;
  contact: string | null;
  minimum: string | null;
  deadline: string | null;
  notes: string | null;
}

export interface ProductSupplier {
  product_id: string;
  supplier_id: string;
  is_main: boolean;
  supplier_code: string | null;
}

const DETAILS =
  'supplier_id, bexio_no, contact_person, email, phone, mobile, website, street, postal_code, city, country, our_customer_no, order_days, lead_time_days, vat_no, uid_no, iban, payment_terms, notes';

export async function getSupplierDetailsMap(): Promise<Record<string, SupplierDetails>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('supplier_details').select(DETAILS);
  if (error) throw new Error(error.message);
  return Object.fromEntries(((data ?? []) as SupplierDetails[]).map((d) => [d.supplier_id, d]));
}

/**
 * The Guías ordering cards, for the office's supplier screen. Read as the
 * system: the cards follow the guide's own readers, and a Power User is not
 * always one — the caller checks the office first.
 */
export async function getSupplierOrderCards(): Promise<Record<string, SupplierOrderCard>> {
  const admin = createAdminClient();
  const { data } = await admin.from('supplier_order_info').select('supplier_id, how, contact, minimum, deadline, notes');
  return Object.fromEntries(((data ?? []) as SupplierOrderCard[]).map((c) => [c.supplier_id, c]));
}

/** Who supplies each product, by product: the main one first. */
export async function getProductSuppliersMap(): Promise<Record<string, ProductSupplier[]>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('product_suppliers').select('product_id, supplier_id, is_main, supplier_code');
  if (error) throw new Error(error.message);
  const map: Record<string, ProductSupplier[]> = {};
  for (const row of (data ?? []) as ProductSupplier[]) (map[row.product_id] ??= []).push(row);
  for (const list of Object.values(map)) list.sort((a, b) => Number(b.is_main) - Number(a.is_main));
  return map;
}

/** Who supplies each raw material or packaging item (inventory items, not products). */
export interface ItemSupplier {
  item_id: string;
  supplier_id: string;
  is_main: boolean;
  supplier_code: string | null;
}

export async function getItemSuppliersMap(): Promise<Record<string, ItemSupplier[]>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('inventory_item_suppliers').select('item_id, supplier_id, is_main, supplier_code');
  if (error) throw new Error(error.message);
  const map: Record<string, ItemSupplier[]> = {};
  for (const row of (data ?? []) as ItemSupplier[]) (map[row.item_id] ??= []).push(row);
  for (const list of Object.values(map)) list.sort((a, b) => Number(b.is_main) - Number(a.is_main));
  return map;
}
