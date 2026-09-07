import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { orderProgress } from '@/domain/orders/progress';
import { weekDays } from '@/domain/orders/scheduling';
import { OVERDUE_LOOKBACK_DAYS } from '@/domain/buckets';
import { addDays, type BusinessDate } from '@/lib/datetime';
import type {
  Customer,
  DeliveryMethod,
  Order,
  OrderWithProgress,
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
  delivery_method_id, status, order_type, note, generated_from_template_id, created_by, updated_by,
  created_at, updated_at,
  customer:customers!inner ( id, name, is_active ),
  delivery_method:delivery_methods ( id, slug, name, sort_order, is_active ),
  lines:order_lines (
    id, order_id, product_id, ordered_quantity, generated_quantity, note, shortfall_reason, position,
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

/**
 * Attach preparation progress once, here, where the rows already are.
 *
 * Every consumer reads `order.progress` instead of calling orderProgress()
 * itself, so the rule has one call site and a change to it — "a cancelled
 * line does not count", say — cannot land in three of five places.
 */
function withProgress(orders: Order[]): OrderWithProgress[] {
  return orders.map((o) => ({
    ...o,
    progress: orderProgress(
      (o.lines ?? []).map((l) => ({
        ordered_quantity: l.ordered_quantity,
        shortfall_reason: l.shortfall_reason,
        allocations: l.allocations ?? [],
      })),
    ),
  }));
}

/** Order Control: filtered by DELIVERY date. */
export async function getOrdersByDelivery(filters: {
  from: BusinessDate;
  to: BusinessDate;
  customerId?: string;
  deliveryMethodId?: string;
  status?: string;
}): Promise<OrderWithProgress[]> {
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
  return withProgress(sortLines((data ?? []) as unknown as Order[]));
}

/**
 * Lotnummerkontrol: filtered by PREPARATION date.
 * Cancelled orders are excluded — there is nothing to prepare.
 */
export async function getOrdersForPreparation(date: BusinessDate): Promise<OrderWithProgress[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('preparation_date', date)
    .neq('status', 'cancelled')
    .order('reference', { ascending: true });

  if (error) throw new Error(error.message);
  return withProgress(sortLines((data ?? []) as unknown as Order[]));
}

export interface PreparationDay {
  /** Orders whose preparation date IS the selected day. */
  due: OrderWithProgress[];
  /**
   * Started on an earlier day and still not complete.
   *
   * Preparation used to be an exact match on the date, so an order left half
   * prepared simply stopped existing at midnight: it was on no list anyone
   * opened, and the dashboard's urgent alert — which reads the same set —
   * could not warn about it either. Unfinished work does not become finished
   * by the day ending.
   */
  carriedOver: OrderWithProgress[];
  /**
   * Days in the visible week that still hold unfinished orders, so the weekday
   * strip can say where the open work is instead of showing seven bare numbers.
   */
  openDays: BusinessDate[];
}

/**
 * Everything the preparation screen needs for one day, in one round trip.
 *
 * The window spans the lookback for carried-over work through the end of the
 * visible week, so the day's own orders, the overdue ones and the per-weekday
 * markers all come from a single query rather than nine.
 */
export async function getPreparationDay(
  date: BusinessDate,
  lookbackDays = OVERDUE_LOOKBACK_DAYS,
): Promise<PreparationDay> {
  const week = weekDays(date);
  // Carried-over work can predate the visible week; the week can extend past
  // the selected day. Take whichever bound is further out on each side.
  const from = addDays(date, -lookbackDays) < week[0] ? addDays(date, -lookbackDays) : week[0];
  const to = week[6] > date ? week[6] : date;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .gte('preparation_date', from)
    .lte('preparation_date', to)
    .neq('status', 'cancelled')
    .order('preparation_date', { ascending: true })
    .order('reference', { ascending: true });

  if (error) throw new Error(error.message);

  const all = withProgress(sortLines((data ?? []) as unknown as Order[]));

  const due = all.filter((o) => o.preparation_date === date);
  const carriedOver = all.filter(
    (o) => o.preparation_date < date && !o.progress.isComplete,
  );

  // A weekday is "open" when something scheduled for it is unfinished. The
  // selected day's own carry-over is not attributed to the days it came from
  // twice — each order marks the day it was scheduled on.
  const openDays = week.filter((d) =>
    all.some((o) => o.preparation_date === d && !o.progress.isComplete),
  );

  return { due, carriedOver, openDays };
}

export async function getOrder(id: string): Promise<OrderWithProgress | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return withProgress(sortLines([data as unknown as Order]))[0];
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
  const [day, delivering] = await Promise.all([
    getPreparationDay(today),
    getOrdersByDelivery({ from: today, to: today }),
  ]);
  return {
    toPrepare: day.due,
    // Kept separate from today's own work so the tile still counts the day,
    // while the urgent alert can consider both — an order left short
    // yesterday and delivering this morning is exactly what that alert is for.
    carriedOver: day.carriedOver,
    delivering,
  };
}
