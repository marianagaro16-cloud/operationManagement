import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { buildReceptionReport, type ReportReception } from '@/domain/goods-reception/report';
import type { ExportableReception } from '@/domain/goods-reception/export';
import type {
  GoodsReception,
  ReceptionAuditEntry,
  ReceptionDetail,
  ReceptionFilters,
  ReceptionListItem,
  ReceptionPage,
  ReceptionReportSnapshot,
  Supplier,
  Transporter,
} from '@/types/goods-reception';
import type { Product } from '@/types/orders';

/**
 * Goods Reception data access.
 *
 * Everything a page renders comes from here, so the UI never talks to the
 * database and never performs aggregation. Runs under the caller's session
 * throughout, so RLS applies — §53: the frontend hiding a button is not what
 * makes a rule true.
 */

export const RECEPTION_PAGE_SIZE = 25;

/**
 * Counts ride along as embedded relations rather than as separate queries.
 * `incidents ( id )` is the reverse of the nullable goods_reception_id link
 * added to the incidents table, so a reception knows its incidents without
 * the incidents module knowing anything about receptions.
 */
const LIST_SELECT = `
  id, reference, reception_number, supplier_id, transporter_id, delivery_note,
  received_at, received_by, condition, quantity_check, comments, status,
  completed_at, completed_by, created_by, updated_by, created_at, updated_at,
  supplier:suppliers ( id, name, is_active ),
  transporter:transporters ( id, name, is_active ),
  receiver:profiles!goods_receptions_received_by_fkey ( id, name, email ),
  exceptions:goods_reception_exceptions ( id ),
  incidents ( id )
`;

type ListRow = GoodsReception & {
  exceptions: { id: string }[] | null;
  incidents: { id: string }[] | null;
};

function toListItem(row: ListRow): ReceptionListItem {
  const { exceptions, incidents, ...reception } = row;
  return {
    ...reception,
    exception_count: exceptions?.length ?? 0,
    incident_count: incidents?.length ?? 0,
  };
}

/* ------------------------------ master data ----------------------------- */

export async function getSuppliers(includeInactive = false): Promise<Supplier[]> {
  const supabase = createClient();
  let query = supabase.from('suppliers').select('id, name, is_active, created_at, updated_at');
  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query.order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Supplier[];
}

export async function getTransporters(includeInactive = false): Promise<Transporter[]> {
  const supabase = createClient();
  let query = supabase.from('transporters').select('id, name, is_active, created_at, updated_at');
  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query.order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Transporter[];
}

/** Products offered when recording an exception. Active only — §22. */
export async function getReceptionProducts(): Promise<Product[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('family')
    .order('presentation');

  if (error) throw new Error(error.message);
  return (data ?? []) as Product[];
}

/* ------------------------------ assignment ------------------------------ */

/** Who is on the standing reception list. Readable by everyone approved. */
export async function getReceptionAssignees(): Promise<
  { user_id: string; assigned_at: string; user: { name: string | null; email: string } | null }[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('goods_reception_assignees')
    .select('user_id, assigned_at, user:profiles!goods_reception_assignees_user_id_fkey ( name, email )')
    .order('assigned_at');

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as {
    user_id: string;
    assigned_at: string;
    user: { name: string | null; email: string } | null;
  }[];
}

/**
 * Is this user on the list?
 *
 * Asked of the caller's own id by every page that decides whether to offer
 * the New Reception button. The database answers the same question again in
 * `can_write_goods_reception()`; this one exists so the screen does not offer
 * an action that would be refused.
 */
export async function isReceptionAssignee(userId: string): Promise<boolean> {
  const supabase = createClient();
  const { count } = await supabase
    .from('goods_reception_assignees')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId);

  return (count ?? 0) > 0;
}

/* -------------------------------- the list ------------------------------- */

function applyFilters<T>(query: T, filters: ReceptionFilters): T {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let q = query as any;

  if (filters.from) q = q.gte('received_at', filters.from);
  if (filters.to) q = q.lte('received_at', filters.to);
  if (filters.supplierId) q = q.eq('supplier_id', filters.supplierId);
  if (filters.transporterId) q = q.eq('transporter_id', filters.transporterId);
  if (filters.receivedBy) q = q.eq('received_by', filters.receivedBy);
  if (filters.condition) q = q.eq('condition', filters.condition);
  if (filters.quantityCheck) q = q.eq('quantity_check', filters.quantityCheck);
  if (filters.status) q = q.eq('status', filters.status);

  if (filters.search) {
    // §45, server-side. The escaping matters: a comma inside `or()` is the
    // clause separator, and a percent from a user would widen the pattern.
    const term = filters.search.trim().replace(/[,%()]/g, ' ');
    if (term) {
      q = q.or(
        `reception_number.ilike.%${term}%,delivery_note.ilike.%${term}%,comments.ilike.%${term}%`,
      );
    }
  }

  return q as T;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function getReceptions(
  filters: ReceptionFilters,
  page = 1,
  pageSize = RECEPTION_PAGE_SIZE,
): Promise<ReceptionPage> {
  const supabase = createClient();
  const offset = (page - 1) * pageSize;

  /*
   * The incident filter is an INNER JOIN when it asks for receptions that
   * have incidents, so the database does the work. "Without incidents" cannot
   * be expressed that way — an absent relation has no row to join — so it is
   * applied to the page after it arrives, exactly as the incidents list does
   * with its own relation filters.
   */
  const select =
    filters.incidents === 'with'
      ? LIST_SELECT.replace('incidents ( id )', 'incidents!inner ( id )')
      : LIST_SELECT;

  const base = supabase.from('goods_receptions').select(select, { count: 'exact' });
  const { data, error, count } = await applyFilters(base, filters)
    .order('received_at', { ascending: false })
    .order('reference', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as ListRow[];
  const mapped = rows.map(toListItem);

  const filtered =
    filters.incidents === 'without' ? mapped.filter((r) => r.incident_count === 0) : mapped;

  return {
    // When the post-filter is active the exact total is not knowable without
    // scanning, so the count reports what the SQL filters matched and the
    // pager says "of N matching" rather than claiming the post-filtered
    // figure. Same compromise the incidents list makes, for the same reason.
    rows: filtered,
    total: count ?? filtered.length,
    page,
    pageSize,
  };
}

/* ------------------------------- the detail ------------------------------ */

const DETAIL_SELECT = `
  id, reference, reception_number, supplier_id, transporter_id, delivery_note,
  received_at, received_by, condition, quantity_check, comments, status,
  completed_at, completed_by, created_by, updated_by, created_at, updated_at,
  supplier:suppliers ( id, name, is_active, created_at, updated_at ),
  transporter:transporters ( id, name, is_active, created_at, updated_at ),
  receiver:profiles!goods_receptions_received_by_fkey ( id, name, email ),
  completer:profiles!goods_receptions_completed_by_fkey ( name, email ),
  exceptions:goods_reception_exceptions (
    id, reception_id, product_id, lot_number, best_before, affected_quantity,
    description, created_by, created_at,
    product:products ( * )
  ),
  evidence:goods_reception_evidence (
    id, reception_id, exception_id, storage_path, file_name, mime_type,
    size_bytes, uploaded_by, created_at,
    uploader:profiles!goods_reception_evidence_uploaded_by_fkey ( name, email )
  ),
  incidents (
    id, incident_number, description, severity, status, detected_at,
    type:incident_types ( slug, name )
  )
`;

export async function getReception(id: string): Promise<ReceptionDetail | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('goods_receptions')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const detail = data as unknown as ReceptionDetail;

  /*
   * Signed URLs are minted per request and never stored. The bucket is
   * private; a path on its own opens nothing, which is what keeps a leaked
   * row from becoming a leaked photograph.
   */
  const evidence = await withSignedUrls(detail.evidence ?? []);

  return {
    ...detail,
    evidence,
    // A photo attached to an exception is shown under that exception as well
    // as in the gallery, so the reader sees the damage beside its description.
    exceptions: (detail.exceptions ?? []).map((e) => ({
      ...e,
      evidence: evidence.filter((f) => f.exception_id === e.id),
    })),
  };
}

async function withSignedUrls<T extends { storage_path: string }>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;

  const supabase = createClient();
  const { data } = await supabase.storage
    .from('goods-reception-evidence')
    .createSignedUrls(rows.map((r) => r.storage_path), 60 * 60);

  const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => ({ ...r, signed_url: urls.get(r.storage_path) ?? null }));
}

/** The audit trail. Requires audit.view_operational; RLS returns [] without it. */
export async function getReceptionHistory(receptionId: string): Promise<ReceptionAuditEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('goods_reception_audit_log')
    .select('*, actor:profiles!goods_reception_audit_log_actor_id_fkey ( name, email )')
    .eq('reception_id', receptionId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReceptionAuditEntry[];
}

/* -------------------------------- export -------------------------------- */

/** The filtered list as flat rows. Runs the SAME filters the screen ran. */
export async function getReceptionsForExport(
  filters: ReceptionFilters,
  limit = 5000,
): Promise<ExportableReception[]> {
  const supabase = createClient();

  const base = supabase.from('goods_receptions').select(LIST_SELECT);
  const { data, error } = await applyFilters(base, filters)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as ListRow[];
  const mapped = rows.map(toListItem);
  const filtered =
    filters.incidents === 'without'
      ? mapped.filter((r) => r.incident_count === 0)
      : filters.incidents === 'with'
        ? mapped.filter((r) => r.incident_count > 0)
        : mapped;

  return filtered.map((r) => ({
    reception_number: r.reception_number,
    received_at: r.received_at,
    status: r.status,
    supplier: r.supplier?.name ?? null,
    transporter: r.transporter?.name ?? null,
    delivery_note: r.delivery_note,
    received_by: r.receiver?.name ?? r.receiver?.email ?? '',
    condition: r.condition,
    quantity_check: r.quantity_check,
    exception_count: r.exception_count,
    incident_count: r.incident_count,
    comments: r.comments,
  }));
}

/* -------------------------------- reports -------------------------------- */

/**
 * The rows one month's report is computed from.
 *
 * A month is a half-open interval on `received_at`, in Zurich time, because
 * that is the instant the delivery arrived — a lorry at 23:50 on the 30th
 * belongs to that month even though UTC has already moved on.
 */
export async function getReceptionsForMonth(month: string): Promise<ReportReception[]> {
  const supabase = createClient();
  const start = `${month}-01T00:00:00+02:00`;
  const [year, mon] = month.split('-').map(Number);
  const nextMonth = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
  const end = `${nextMonth}-01T00:00:00+02:00`;

  const { data, error } = await supabase
    .from('goods_receptions')
    .select(LIST_SELECT)
    .gte('received_at', start)
    .lt('received_at', end)
    .order('received_at');

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as ListRow[];
  return rows.map(toListItem).map((r) => ({
    id: r.id,
    reception_number: r.reception_number,
    received_at: r.received_at,
    status: r.status,
    condition: r.condition,
    quantity_check: r.quantity_check,
    supplier_id: r.supplier_id,
    supplier_name: r.supplier?.name ?? null,
    transporter_id: r.transporter_id,
    transporter_name: r.transporter?.name ?? null,
    received_by: r.received_by,
    received_by_name: r.receiver?.name ?? r.receiver?.email ?? '',
    incident_count: r.incident_count,
    exception_count: r.exception_count,
  }));
}

/**
 * The live report for a month — the same function the snapshot freezes.
 *
 * `unrecordedLabel` is passed in rather than looked up, so this layer stays
 * free of i18n and the domain stays free of both.
 */
export async function buildLiveReceptionReport(month: string, unrecordedLabel: string) {
  const receptions = await getReceptionsForMonth(month);
  return {
    payload: buildReceptionReport({ period: month, receptions, unrecordedLabel }),
    receptionIds: receptions.map((r) => r.id),
  };
}

export async function getReceptionReportSnapshots(): Promise<ReceptionReportSnapshot[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('goods_reception_report_snapshots')
    .select('*, generator:profiles!goods_reception_report_snapshots_generated_by_fkey ( name, email )')
    .order('period_month', { ascending: false })
    .order('version', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReceptionReportSnapshot[];
}

export async function getReceptionReportSnapshot(
  id: string,
): Promise<ReceptionReportSnapshot | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('goods_reception_report_snapshots')
    .select('*, generator:profiles!goods_reception_report_snapshots_generated_by_fkey ( name, email )')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as unknown as ReceptionReportSnapshot) ?? null;
}
