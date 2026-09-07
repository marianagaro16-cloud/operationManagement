import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from './data';
import type { BusinessDate } from '@/lib/datetime';
import type { Database } from '@/types/database.types';

/**
 * Lot Nummer Tracker — the read layer.
 *
 * Answers one question: WHERE WAS THIS LOT USED? It creates nothing. Every
 * row comes from `lot_allocations`, which Lotnummerkontrol writes and which
 * remains the single source of truth, so a lot number corrected during
 * preparation is corrected here at the same instant. There is no copy to fall
 * out of date and no synchronisation step that can fail.
 *
 * Reads go through `lot_allocation_search`, a view that flattens the joins
 * this screen filters and sorts on. It holds no data of its own and runs
 * `security_invoker`, so RLS still decides every row.
 *
 * Filtering, sorting and paging all happen in Postgres. The dataset is small
 * today and will not stay that way — every order line prepared adds rows
 * forever — so pulling history into the browser to filter it would work now
 * and quietly stop working later.
 */

export interface LotFilters {
  /** Partial, case-insensitive. The primary field. */
  lot?: string;
  product?: string;
  productCode?: string;
  customer?: string;
  /** The human-facing order number (#1042), not the uuid. */
  reference?: string;
  /** Inclusive, against the order's preparation date. */
  preparedFrom?: BusinessDate;
  preparedTo?: BusinessDate;
  /** Inclusive, against the order's delivery date. */
  deliveredFrom?: BusinessDate;
  deliveredTo?: BusinessDate;
  /** Profile id of whoever entered or last touched the allocation. */
  userId?: string;
  sort?: LotSort;
  limit?: number;
  offset?: number;
}

export type LotSort =
  | 'recent'
  | 'preparation'
  | 'delivery'
  | 'lot'
  | 'customer'
  | 'product';

export interface LotAllocationRow {
  id: string;
  lot_number: string;
  quantity: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  entered_by: string | null;
  modified_by: string | null;
  product_name: string;
  product_code: string | null;
  customer_name: string;
  customer_addition: string | null;
  customer_active: boolean;
  order_id: string;
  order_reference: number;
  order_status: string;
  preparation_date: BusinessDate;
  delivery_date: BusinessDate;
}

const COLUMNS =
  'id, lot_number, quantity, note, created_at, updated_at, entered_by, modified_by, ' +
  'order_id, order_reference, order_status, preparation_date, delivery_date, ' +
  'product_name, product_code, customer_name, customer_addition, customer_active';

/** Flat columns, so the database can order by any of them. */
const ORDER_BY: Record<LotSort, { column: string; ascending: boolean }> = {
  // Operational default: what was prepared most recently is what someone is
  // usually asking about.
  recent: { column: 'created_at', ascending: false },
  preparation: { column: 'preparation_date', ascending: false },
  delivery: { column: 'delivery_date', ascending: false },
  lot: { column: 'lot_number', ascending: true },
  customer: { column: 'customer_name', ascending: true },
  product: { column: 'product_name', ascending: true },
};

export interface LotSearchResult {
  rows: LotAllocationRow[];
  /** Matching allocations in total, not just on this page. */
  total: number;
  /** Summed quantity of the WHOLE match, which is the traceability answer. */
  totalQuantity: number;
}

/**
 * May this viewer use the Tracker at all?
 *
 * Gated on `orders.manage` — held by admin, manager and power user, never by
 * a plain user, which is exactly the required matrix. It is also the right
 * capability rather than a convenient one: the Tracker's whole call to action
 * is "open the order and correct it there", and that is unreachable without
 * it.
 *
 * NOT enforced by RLS, deliberately. `lot_allocations` must stay readable by
 * every approved user because Lotnummerkontrol is how they do their job;
 * narrowing that policy to gate a reporting screen would break preparation.
 * So the gate lives here and in the route, and is checked on every call
 * rather than assumed from the page having checked already.
 */
export async function canUseLotTracker(): Promise<boolean> {
  const viewer = await getViewer();
  return viewer?.can('orders.manage') ?? false;
}

/** `%` and `_` are LIKE wildcards; a lot number containing one is not. */
function contains(value: string): string {
  return `%${value.trim().replace(/[%_\\]/g, '\\$&')}%`;
}

/**
 * A row of the view, as Postgres describes it. Every column is nullable
 * because a view carries no NOT NULL guarantees — shape() is where that is
 * resolved into the non-null contract the UI relies on.
 */
type SearchRow = Database['public']['Views']['lot_allocation_search']['Row'];

function fromSearch() {
  return createClient().from('lot_allocation_search');
}

/** What awaiting a filtered query gives back, once the builder is widened. */
interface QueryResult {
  data: SearchRow[] | null;
  error: { message: string } | null;
  count: number | null;
}

/**
 * Every filter, applied once, so the page and its total can never disagree.
 */
// The builder is widened for the duration of this function only. Supabase's
// generics resolve the row type through every chained call, and a helper that
// stays generic across five different operators hits an instantiation depth
// limit. The RESULT is typed again at each call site, so the rows the rest of
// the file works with are fully checked.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, filters: LotFilters): any {
  let q = query;

  if (filters.lot?.trim()) q = q.ilike('lot_number', contains(filters.lot));
  if (filters.product?.trim()) q = q.ilike('product_name', contains(filters.product));
  if (filters.productCode?.trim()) q = q.ilike('product_code', contains(filters.productCode));
  if (filters.customer?.trim()) {
    // Name OR addition: the master data splits a company across two columns
    // and a searcher does not know which half they remember.
    const term = contains(filters.customer);
    q = q.or(`customer_name.ilike.${term},customer_addition.ilike.${term}`);
  }
  if (filters.reference?.trim()) {
    const digits = filters.reference.replace(/\D/g, '');
    if (digits) q = q.eq('order_reference', Number(digits));
  }
  if (filters.preparedFrom) q = q.gte('preparation_date', filters.preparedFrom);
  if (filters.preparedTo) q = q.lte('preparation_date', filters.preparedTo);
  if (filters.deliveredFrom) q = q.gte('delivery_date', filters.deliveredFrom);
  if (filters.deliveredTo) q = q.lte('delivery_date', filters.deliveredTo);
  if (filters.userId) {
    q = q.or(`created_by.eq.${filters.userId},updated_by.eq.${filters.userId}`);
  }

  return q;
}

function shape(r: SearchRow): LotAllocationRow {
  return {
    id: r.id as string,
    lot_number: r.lot_number as string,
    quantity: Number(r.quantity),
    note: (r.note as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    entered_by: (r.entered_by as string | null) ?? null,
    modified_by: (r.modified_by as string | null) ?? null,
    product_name: (r.product_name as string | null) ?? '—',
    product_code: (r.product_code as string | null) ?? null,
    customer_name: r.customer_name as string,
    customer_addition: (r.customer_addition as string | null) ?? null,
    customer_active: Boolean(r.customer_active),
    order_id: r.order_id as string,
    order_reference: Number(r.order_reference),
    order_status: r.order_status as string,
    preparation_date: r.preparation_date as BusinessDate,
    delivery_date: r.delivery_date as BusinessDate,
  };
}

export async function searchLotAllocations(
  filters: LotFilters = {},
): Promise<LotSearchResult> {
  if (!(await canUseLotTracker())) {
    // Never a partial result: a caller without the capability gets nothing,
    // whether it arrived from the page or by calling this directly.
    return { rows: [], total: 0, totalQuantity: 0 };
  }

  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const order = ORDER_BY[filters.sort ?? 'recent'];

  const page = applyFilters(fromSearch().select(COLUMNS, { count: 'exact' }), filters)
    .order(order.column, { ascending: order.ascending })
    // A stable tiebreak, so paging cannot show the same row twice or skip one
    // when several share a preparation date.
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);

  const { data, error, count } = (await page) as QueryResult;
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map(shape);
  const total = count ?? rows.length;

  return {
    rows,
    total,
    totalQuantity: await sumQuantity(filters, rows, total, limit),
  };
}

/**
 * The total across the WHOLE match, not the page.
 *
 * "How much of this lot was used" is the question the Tracker exists to
 * answer, and answering it from one page would be wrong the moment there is a
 * second. When everything fits on one page the rows already in hand are
 * summed; otherwise one narrow column is fetched rather than the joined rows
 * again.
 */
async function sumQuantity(
  filters: LotFilters,
  rows: LotAllocationRow[],
  total: number,
  limit: number,
): Promise<number> {
  if (total <= limit) return rows.reduce((sum, r) => sum + r.quantity, 0);

  const { data, error } = (await applyFilters(fromSearch().select('quantity'), filters)) as QueryResult;
  if (error) throw new Error(error.message);

  return (data ?? []).reduce((sum, r) => sum + Number(r.quantity ?? 0), 0);
}

/**
 * Every allocation carrying one exact lot number.
 *
 * The lot number is NOT unique — the same number legitimately belongs to
 * different products, and this database already contains one used twice — so
 * this is a group, not a record, and the detail view shows the product
 * context of each row rather than pretending there is one.
 */
export async function getLotDetail(lotNumber: string): Promise<{
  rows: LotAllocationRow[];
  totalQuantity: number;
  orderCount: number;
  customerCount: number;
  productCount: number;
} | null> {
  if (!(await canUseLotTracker())) return null;

  const { data, error } = (await fromSearch()
    .select(COLUMNS)
    .eq('lot_number', lotNumber)
    .order('created_at', { ascending: false })) as QueryResult;

  if (error) throw new Error(error.message);

  const rows = (data ?? []).map(shape);
  if (rows.length === 0) return null;

  return {
    rows,
    totalQuantity: rows.reduce((sum: number, r: LotAllocationRow) => sum + r.quantity, 0),
    orderCount: new Set(rows.map((r: LotAllocationRow) => r.order_id)).size,
    customerCount: new Set(rows.map((r: LotAllocationRow) => r.customer_name)).size,
    productCount: new Set(rows.map((r: LotAllocationRow) => r.product_name)).size,
  };
}

/**
 * What the audit trail already holds about this lot.
 *
 * Read from `order_audit_log`, where the new lot trigger writes and where
 * order and line changes have always been recorded — not a second log built
 * for this screen.
 */
export async function getLotHistory(lotNumber: string): Promise<
  {
    id: string;
    action: string;
    created_at: string;
    actor: string | null;
    detail: Record<string, unknown> | null;
  }[]
> {
  if (!(await canUseLotTracker())) return [];

  const supabase = createClient();
  const { data, error } = await supabase
    .from('order_audit_log')
    .select('id, action, created_at, detail, actor:profiles!order_audit_log_actor_id_fkey ( name, email )')
    .in('action', ['lot_added', 'lot_changed', 'lot_removed'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    action: string;
    created_at: string;
    detail: Record<string, unknown> | null;
    actor: { name: string | null; email: string } | null;
  };

  // Filtered in memory because the lot number sits inside the jsonb detail,
  // under a different key for a change than for an add. Bounded by the limit
  // above, so this is a scan of at most 200 small rows.
  return ((data ?? []) as unknown as Row[])
    .filter((r) => {
      const d = r.detail ?? {};
      const before = (d.before ?? {}) as Record<string, unknown>;
      const after = (d.after ?? {}) as Record<string, unknown>;
      return (
        d.lot_number === lotNumber ||
        before.lot_number === lotNumber ||
        after.lot_number === lotNumber
      );
    })
    .map((r) => ({
      id: r.id,
      action: r.action,
      created_at: r.created_at,
      actor: r.actor ? (r.actor.name ?? r.actor.email) : null,
      detail: r.detail,
    }));
}
