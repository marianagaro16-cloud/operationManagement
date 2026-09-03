/**
 * Orders module types. Mirrors the SQL in 20260902120000_orders_module.sql.
 * Regenerate the authoritative version with `npm run db:types`.
 */

export type OrderStatus = 'draft' | 'confirmed' | 'cancelled';
export type OrderType = 'sale' | 'sample';

export interface Customer {
  id: string;
  /** Legal entity name, e.g. "5 Almas AG". */
  company_name: string;
  /** Trading name, e.g. "La Catedral". Kept separate on purpose. */
  company_name_addition: string | null;
  /** Derived display value: company_name [— addition]. Generated in Postgres. */
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** "5 Almas AG — La Catedral", or just the company when there is no addition. */
export function customerLabel(
  c: Pick<Customer, 'company_name' | 'company_name_addition'>,
): string {
  return c.company_name_addition?.trim()
    ? `${c.company_name} — ${c.company_name_addition}`
    : c.company_name;
}

export interface DeliveryMethod {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface Product {
  id: string;
  code: string | null;
  /** Product name exactly as imported. Never parsed. */
  name: string | null;
  family: string;
  presentation: string;
  category: string | null;
  notes: string | null;
  needs_review: boolean;
  is_active: boolean;
}

/**
 * Display name for a product.
 *
 * Prefers the imported name, which is the source of truth. Falls back to the
 * legacy family/presentation pair so deactivated products from the earlier
 * import still render on historical orders.
 */
export function productLabel(
  p: Pick<Product, 'family' | 'presentation'> & { name?: string | null },
): string {
  if (p.name?.trim()) return p.name;
  if (p.presentation && p.presentation !== '—') return `${p.family} — ${p.presentation}`;
  return p.family;
}

export interface LotAllocation {
  id: string;
  order_line_id: string;
  lot_number: string;
  quantity: number | string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  author?: { name: string | null; email: string } | null;
}

export interface OrderLine {
  id: string;
  order_id: string;
  product_id: string;
  ordered_quantity: number | string;
  note: string | null;
  shortfall_reason: string | null;
  position: number;
  product: Product;
  allocations: LotAllocation[];
}

export interface Order {
  id: string;
  reference: number;
  customer_id: string;
  order_date: string;
  delivery_date: string;
  /** Wall-clock deadline in Europe/Zurich, "HH:MM:SS". Null = no set hour. */
  delivery_time: string | null;
  preparation_date: string;
  delivery_method_id: string | null;
  status: OrderStatus;
  order_type: OrderType;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  customer: Customer;
  delivery_method: DeliveryMethod | null;
  lines: OrderLine[];
}

export interface RecurringTemplate {
  id: string;
  customer_id: string;
  name: string | null;
  delivery_weekday: number;
  preparation_lead_days: number;
  delivery_method_id: string | null;
  order_type: OrderType;
  note: string | null;
  is_active: boolean;
  customer: Customer;
  lines?: { id: string; product_id: string; default_quantity: number | string; product: Product }[];
}
