import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { BusinessDate } from '@/lib/datetime';
import type {
  Customer,
  DeliveryMethod,
  Order,
  Product,
  RecurringTemplate,
} from '@/types/orders';

/**
 * Orders data access.
 *
 * Order Control and Lotnummerkontrol read the SAME rows — they differ only in
 * which date column they filter on (delivery vs preparation) and how they
 * group. There is deliberately no second copy of order data anywhere.
 */

const ORDER_SELECT = `
  id, reference, customer_id, order_date, delivery_date, delivery_time, preparation_date,
  delivery_method_id, status, order_type, note, created_by, updated_by,
  created_at, updated_at,
  customer:customers!inner ( id, company_name, company_name_addition, name, is_active, created_at, updated_at ),
  delivery_method:delivery_methods ( id, slug, name, sort_order, is_active ),
  lines:order_lines (
    id, order_id, product_id, ordered_quantity, note, shortfall_reason, position,
    product:products ( id, code, name, family, presentation, category, notes, needs_review, is_active ),
    allocations:lot_allocations (
      id, order_line_id, lot_number, quantity, note, created_by, created_at, updated_at,
      author:profiles!lot_allocations_created_by_fkey ( name, email )
    )
  )
`;

function sortLines(orders: Order[]): Order[] {
  for (const o of orders) {
    o.lines?.sort((a, b) => a.position - b.position || a.product.family.localeCompare(b.product.family));
    for (const l of o.lines ?? []) {
      l.allocations?.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
  }
  return orders;
}

/** Order Control: filtered by DELIVERY date. */
export async function getOrdersByDelivery(filters: {
  from: BusinessDate;
  to: BusinessDate;
  customerId?: string;
  deliveryMethodId?: string;
  status?: string;
}): Promise<Order[]> {
  const supabase = createClient();
  let q = supabase
    .from('orders')
    .select(ORDER_SELECT)
    .gte('delivery_date', filters.from)
    .lte('delivery_date', filters.to)
    .order('delivery_date', { ascending: true })
    .order('reference', { ascending: true });

  if (filters.customerId) q = q.eq('customer_id', filters.customerId);
  if (filters.deliveryMethodId) q = q.eq('delivery_method_id', filters.deliveryMethodId);
  if (filters.status) q = q.eq('status', filters.status);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return sortLines((data ?? []) as unknown as Order[]);
}

/**
 * Lotnummerkontrol: filtered by PREPARATION date.
 * Cancelled orders are excluded — there is nothing to prepare.
 */
export async function getOrdersForPreparation(date: BusinessDate): Promise<Order[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('preparation_date', date)
    .neq('status', 'cancelled')
    .order('reference', { ascending: true });

  if (error) throw new Error(error.message);
  return sortLines((data ?? []) as unknown as Order[]);
}

export async function getOrder(id: string): Promise<Order | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return sortLines([data as unknown as Order])[0];
}

/* ------------------------------ master data ----------------------------- */

export async function getCustomers(includeInactive = false): Promise<Customer[]> {
  const supabase = createClient();
  let q = supabase.from('customers').select('*').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Customer[];
}

export async function getProducts(includeInactive = false): Promise<Product[]> {
  const supabase = createClient();
  // Imported name is the display order; legacy rows fall back to family.
  let q = supabase.from('products').select('*').order('name', { nullsFirst: false }).order('family');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Product[];
}

export async function getDeliveryMethods(includeInactive = false): Promise<DeliveryMethod[]> {
  const supabase = createClient();
  let q = supabase.from('delivery_methods').select('*').order('sort_order');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as DeliveryMethod[];
}

export async function getRecurringTemplates(): Promise<RecurringTemplate[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('recurring_order_templates')
    .select(`
      *, customer:customers!inner ( id, company_name, company_name_addition, name, is_active, created_at, updated_at ),
      lines:recurring_order_template_lines (
        id, product_id, default_quantity,
        product:products ( id, code, name, family, presentation, category, notes, needs_review, is_active )
      )
    `)
    .order('delivery_weekday')
    .order('is_active', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RecurringTemplate[];
}

/** Dashboard: what is being prepared today and what still needs attention. */
export async function getOrderDashboardSummary(today: BusinessDate) {
  const [toPrepare, delivering] = await Promise.all([
    getOrdersForPreparation(today),
    getOrdersByDelivery({ from: today, to: today }),
  ]);
  return { toPrepare, delivering };
}
