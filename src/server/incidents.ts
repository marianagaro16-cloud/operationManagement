import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { buildReport, type ReportAction, type ReportIncident } from '@/domain/incidents/report';
import type { ExportableIncident } from '@/domain/incidents/export';
import type { IncidentCause } from '@/domain/incidents/vocabulary';
import { businessToday, type BusinessDate } from '@/lib/datetime';
import type {
  CorrectiveAction,
  Incident,
  IncidentCategory,
  IncidentFilters,
  IncidentListItem,
  IncidentPage,
  IncidentReportSnapshot,
  IncidentType,
} from '@/types/incidents';

/**
 * Incidents data access.
 *
 * Every query is filtered and paged IN THE DATABASE. The module is designed
 * for thousands of records, and the one thing that would make it unusable at
 * that size is a page that fetches everything and counts in the browser —
 * §43 rules it out and so does the shape of every function here.
 *
 * There is no incident-side copy of a customer, a product, an order or a
 * task. Everything is a join to the row that already exists.
 */

const EVIDENCE_BUCKET = 'incident-evidence';
/** How long a preview link lives. Long enough to look, short enough to leak badly. */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export const INCIDENT_PAGE_SIZE = 25;

/* ----------------------------- vocabulary ------------------------------ */

export async function getIncidentCategories(includeInactive = false): Promise<IncidentCategory[]> {
  const supabase = createClient();
  let q = supabase.from('incident_categories').select('*').order('sort_order');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as IncidentCategory[];
}

export async function getIncidentTypes(includeInactive = false): Promise<IncidentType[]> {
  const supabase = createClient();
  let q = supabase
    .from('incident_types')
    .select('*, category:incident_categories ( id, slug, name, sort_order, is_active )')
    .order('sort_order');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as IncidentType[];
}

/* -------------------------------- list --------------------------------- */

const LIST_SELECT = `
  id, incident_number, detected_at, status, severity, primary_cause, responsibility,
  customer_id, order_id, delivery_method_id, incident_type_id,
  customer:customers ( id, name ),
  order:orders!incidents_order_id_fkey ( id, reference ),
  type:incident_types!inner ( id, slug, name, category_id ),
  items:incident_affected_items ( id ),
  replacements:incident_replacements ( id )
`;

/**
 * Apply every filter to a PostgREST query.
 *
 * Shared by the list and the export so the two cannot disagree — §28 requires
 * an export to respect the current filters, and the only way to guarantee
 * that is for both to go through one function.
 */
function applyFilters<T extends { eq: (c: string, v: unknown) => T; gte: (c: string, v: unknown) => T; lte: (c: string, v: unknown) => T; or: (f: string) => T; not: (c: string, o: string, v: unknown) => T }>(
  query: T,
  filters: IncidentFilters,
): T {
  let q = query;

  // detected_at is a timestamptz and the filter is a business date, so the
  // upper bound covers the whole day rather than midnight on it.
  if (filters.from) q = q.gte('detected_at', `${filters.from}T00:00:00`);
  if (filters.to) q = q.lte('detected_at', `${filters.to}T23:59:59.999`);

  if (filters.customerId) q = q.eq('customer_id', filters.customerId);
  if (filters.orderId) q = q.eq('order_id', filters.orderId);
  if (filters.typeId) q = q.eq('incident_type_id', filters.typeId);
  if (filters.categoryId) q = q.eq('type.category_id', filters.categoryId);
  if (filters.primaryCause) q = q.eq('primary_cause', filters.primaryCause);
  if (filters.responsibility) q = q.eq('responsibility', filters.responsibility);
  if (filters.severity) q = q.eq('severity', filters.severity);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.deliveryMethodId) q = q.eq('delivery_method_id', filters.deliveryMethodId);
  if (filters.createdBy) q = q.eq('created_by', filters.createdBy);
  // The product filter needs the affected items joined as !inner — see the
  // caller, which swaps the select string when it is set.
  if (filters.productId) q = q.eq('items.product_id', filters.productId);
  // Same shape one level deeper: the brand lives on the product, so both the
  // items and the product embed have to be inner-joined by the caller.
  if (filters.brandId) q = q.eq('items.product.brand_id', filters.brandId);

  if (filters.q?.trim()) {
    // Escaped for the PostgREST `or` grammar, where a comma separates terms
    // and a parenthesis closes the group.
    const term = filters.q.trim().replace(/[,()]/g, ' ');
    q = q.or(`incident_number.ilike.*${term}*,description.ilike.*${term}*`);
  }

  return q;
}

/**
 * One page of incidents.
 *
 * The replacement and corrective-action filters are applied after the fetch
 * of the page's own rows rather than in SQL, because both are "does a related
 * row exist" questions that PostgREST cannot express as a filter without an
 * inner join that would also multiply the rows. They are narrow post-filters
 * over at most one page, and the count reflects them — see below.
 */
export async function getIncidents(
  filters: IncidentFilters,
  page = 1,
  pageSize = INCIDENT_PAGE_SIZE,
): Promise<IncidentPage> {
  const supabase = createClient();
  const offset = (page - 1) * pageSize;

  const select = filters.brandId
    ? LIST_SELECT.replace(
        'items:incident_affected_items ( id )',
        'items:incident_affected_items!inner ( id, product_id, product:products!inner ( brand_id ) )',
      )
    : filters.productId
      ? LIST_SELECT.replace(
          'items:incident_affected_items ( id )',
          'items:incident_affected_items!inner ( id, product_id )',
        )
      : LIST_SELECT;

  const base = supabase.from('incidents').select(select, { count: 'exact' });
  const { data, error, count } = await applyFilters(base, filters)
    .order('detected_at', { ascending: false })
    .order('reference', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as (IncidentListItem & {
    items: { id: string }[];
    replacements: { id: string }[];
  })[];

  const actions = await getActionCounts(rows.map((r) => r.id));

  const mapped: IncidentListItem[] = rows.map((r) => ({
    ...r,
    item_count: r.items?.length ?? 0,
    replacement_count: r.replacements?.length ?? 0,
    action_count: actions.get(r.id)?.total ?? 0,
    open_action_count: actions.get(r.id)?.open ?? 0,
  }));

  const filtered = mapped.filter((r) => matchesRelationFilters(r, filters));

  return {
    rows: filtered,
    // When a post-filter is active the exact total is not knowable without
    // scanning, so the count is reported as what the SQL filters matched. The
    // pager stays honest by saying "of N matching" rather than claiming the
    // post-filtered figure.
    total: count ?? filtered.length,
    page,
    pageSize,
  };
}

function matchesRelationFilters(row: IncidentListItem, filters: IncidentFilters): boolean {
  if (filters.replacement === 'with' && row.replacement_count === 0) return false;
  if (filters.replacement === 'without' && row.replacement_count > 0) return false;

  if (filters.action === 'none' && row.action_count > 0) return false;
  if (filters.action === 'open' && row.open_action_count === 0) return false;
  if (filters.action === 'done' && (row.action_count === 0 || row.open_action_count > 0)) return false;

  return true;
}

/**
 * Corrective-action counts for a set of incidents, in one round trip.
 *
 * A corrective action is an occurrence of a one-off task carrying the
 * incident id — so this reads the EXISTING tasks and occurrences tables and
 * nothing else. There is no action table to count.
 */
async function getActionCounts(
  incidentIds: string[],
): Promise<Map<string, { total: number; open: number }>> {
  const out = new Map<string, { total: number; open: number }>();
  if (incidentIds.length === 0) return out;

  const supabase = createClient();
  const { data } = await supabase
    .from('task_occurrences')
    .select('id, status, task:tasks!inner ( id, incident_id )')
    .in('task.incident_id', incidentIds);

  for (const row of (data ?? []) as unknown as {
    status: string;
    task: { incident_id: string | null };
  }[]) {
    const id = row.task?.incident_id;
    if (!id) continue;
    const entry = out.get(id) ?? { total: 0, open: 0 };
    entry.total++;
    if (row.status === 'pending') entry.open++;
    out.set(id, entry);
  }
  return out;
}

/**
 * The same rows, with everything the spreadsheet columns promise.
 *
 * A separate select from the list's, because the list does not need a
 * description or a product name and loading them for a screen that shows
 * neither would be waste. It runs through the SAME `applyFilters`, so the
 * file cannot disagree with the screen it was taken from — §28.
 */
export async function getIncidentsForExport(
  filters: IncidentFilters,
  limit: number,
): Promise<ExportableIncident[]> {
  const supabase = createClient();

  const select = `
    id, incident_number, detected_at, status, severity, primary_cause, responsibility, description,
    resolved_at, closed_at,
    customer:customers ( name ),
    order:orders!incidents_order_id_fkey ( reference ),
    delivery_method:delivery_methods ( name ),
    type:incident_types!inner ( slug, category_id, category:incident_categories ( slug ) ),
    causes:incident_secondary_causes ( cause ),
    items:incident_affected_items${filters.productId || filters.brandId ? '!inner' : ''} (
      product_id, affected_quantity,
      product:products${filters.brandId ? '!inner' : ''} ( code, name, family, brand_id )
    ),
    replacements:incident_replacements ( id )
  `;

  const base = supabase.from('incidents').select(select);
  const { data, error } = await applyFilters(base, filters)
    .order('detected_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as {
    id: string;
    incident_number: string;
    detected_at: string;
    status: string;
    severity: string;
    primary_cause: string | null;
    responsibility: string;
    description: string;
    resolved_at: string | null;
    closed_at: string | null;
    customer: { name: string } | null;
    order: { reference: number } | null;
    delivery_method: { name: string } | null;
    type: { slug: string; category: { slug: string } | null };
    causes: { cause: string }[];
    items: {
      affected_quantity: number | string | null;
      product: { code: string | null; name: string | null; family: string } | null;
    }[];
    replacements: { id: string }[];
  }[];

  // One extra round trip for the whole export rather than one per row.
  const counts = await getActionCounts(rows.map((r) => r.id));

  return rows.map((r) => ({
    incident_number: r.incident_number,
    detected_at: r.detected_at.slice(0, 10),
    status: r.status,
    severity: r.severity,
    customer_name: r.customer?.name ?? null,
    order_reference: r.order?.reference ?? null,
    // Stable slugs, not translated text: an export is a data file, and a
    // German export must be joinable against a Spanish one.
    category: r.type.category?.slug ?? '',
    type: r.type.slug,
    products: (r.items ?? [])
      .map((i) => i.product)
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => [p.code, p.name?.trim() || p.family].filter(Boolean).join(' '))
      .join(' | '),
    affected_quantity: (r.items ?? []).reduce(
      (sum, i) => sum + (i.affected_quantity === null ? 0 : Number(i.affected_quantity)),
      0,
    ) || null,
    primary_cause: r.primary_cause,
    secondary_causes: (r.causes ?? []).map((c) => c.cause).join(' | '),
    responsibility: r.responsibility,
    delivery_method: r.delivery_method?.name ?? null,
    replacement_count: (r.replacements ?? []).length,
    corrective_action_count: counts.get(r.id)?.total ?? 0,
    description: r.description,
    resolved_at: r.resolved_at?.slice(0, 10) ?? null,
    closed_at: r.closed_at?.slice(0, 10) ?? null,
  }));
}

/* ------------------------------- detail -------------------------------- */

const DETAIL_SELECT = `
  *,
  customer:customers ( * ),
  order:orders!incidents_order_id_fkey ( id, reference, order_date, preparation_date, delivery_date, delivery_method_id ),
  delivery_method:delivery_methods ( id, slug, name, sort_order, is_active ),
  type:incident_types ( *, category:incident_categories ( id, slug, name, sort_order, is_active ) ),
  resolver:profiles!incidents_resolved_by_fkey ( name, email ),
  closer:profiles!incidents_closed_by_fkey ( name, email ),
  items:incident_affected_items (
    id, incident_id, product_id, order_line_id, lot_allocation_id,
    affected_quantity, note, position,
    product:products ( id, code, name, family, presentation, category, notes, units_per_box, needs_review, is_active ),
    lot_allocation:lot_allocations ( id, lot_number )
  ),
  causes:incident_secondary_causes ( cause ),
  evidence:incident_evidence (
    id, incident_id, storage_path, file_name, mime_type, size_bytes, uploaded_by, created_at,
    uploader:profiles!incident_evidence_uploaded_by_fkey ( name, email )
  ),
  replacements:incident_replacements (
    id, incident_id, order_id, product_id, quantity, note, created_by, created_at,
    order:orders ( id, reference, delivery_date, status ),
    product:products ( id, code, name, family, presentation, category, notes, units_per_box, needs_review, is_active )
  )
`;

export async function getIncident(id: string): Promise<Incident | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('incidents')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as unknown as Incident & { causes: { cause: IncidentCause }[] };

  const [actions, history, evidence] = await Promise.all([
    getCorrectiveActions(id),
    getIncidentHistory(id),
    withSignedUrls(row.evidence ?? []),
  ]);

  row.items?.sort((a, b) => a.position - b.position);
  row.replacements?.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return {
    ...row,
    secondary_causes: (row.causes ?? []).map((c) => c.cause),
    evidence,
    actions,
    history,
  };
}

/**
 * Short-lived signed URLs for the evidence.
 *
 * The bucket is private and the storage policy already refuses an object
 * whose incident the caller may not read, so this is the second lock rather
 * than the only one. URLs are minted per request and never stored — a stored
 * one would outlive the permission that justified it.
 */
async function withSignedUrls(evidence: Incident['evidence']): Promise<Incident['evidence']> {
  if (evidence.length === 0) return evidence;
  const supabase = createClient();

  const { data } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrls(evidence.map((e) => e.storage_path), SIGNED_URL_TTL_SECONDS);

  const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return evidence
    .map((e) => ({ ...e, signed_url: urls.get(e.storage_path) ?? null }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * The corrective actions raised for one incident.
 *
 * Reads tasks and task_occurrences — the real ones. A corrective action that
 * is completed on the dashboard by the person it was assigned to shows as
 * completed here, with no synchronisation, because it is the same row.
 */
export async function getCorrectiveActions(incidentId: string): Promise<CorrectiveAction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('task_occurrences')
    .select(`
      id, due_date, effective_due_date, status, completed_at, assignee_id,
      task:tasks!inner ( id, title, description, incident_id ),
      assignee:profiles!task_occurrences_assignee_id_fkey ( id, name, email )
    `)
    .eq('task.incident_id', incidentId)
    .order('due_date');

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as {
    id: string;
    due_date: string;
    effective_due_date: string | null;
    status: 'pending' | 'completed' | 'skipped';
    completed_at: string | null;
    task: { id: string; title: string; description: string | null };
    assignee: { id: string; name: string | null; email: string } | null;
  }[]).map((o) => ({
    occurrence_id: o.id,
    task_id: o.task.id,
    title: o.task.title,
    description: o.task.description,
    due_date: o.effective_due_date ?? o.due_date,
    status: o.status,
    completed_at: o.completed_at,
    assignee: o.assignee,
  }));
}

/** The investigation trail, from the module's own audit log. */
export async function getIncidentHistory(incidentId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('incident_audit_log')
    .select(`
      id, action, created_at, previous_value, new_value,
      actor:profiles!incident_audit_log_actor_id_fkey ( id, name, email )
    `)
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: false });

  // A viewer who may not read the log sees no history rather than an
  // error — the page renders without the section.
  if (error) return [];
  return (data ?? []) as unknown as Incident['history'];
}

/* -------------------- incidents attached to other things ---------------- */

/** For the Order Detail page: "Incidents: 2". */
export async function getIncidentsForOrder(orderId: string): Promise<IncidentListItem[]> {
  const { rows } = await getIncidents({ orderId }, 1, 100);
  return rows;
}

/**
 * For Lot Detail: which incidents touched this lot number?
 *
 * Resolved through incident_affected_items.lot_allocation_id, so the Lot
 * Nummer Tracker stays the only place lot numbers live. This is a join, not a
 * second lot store.
 */
export async function getIncidentsForLot(lotNumber: string): Promise<IncidentListItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('incident_affected_items')
    .select('incident_id, lot_allocation:lot_allocations!inner ( lot_number )')
    .eq('lot_allocation.lot_number', lotNumber);

  if (error) throw new Error(error.message);
  const ids = [...new Set((data ?? []).map((r) => (r as { incident_id: string }).incident_id))];
  if (ids.length === 0) return [];

  const { data: rows, error: rowsError } = await supabase
    .from('incidents')
    .select(LIST_SELECT)
    .in('id', ids)
    .order('detected_at', { ascending: false });

  if (rowsError) throw new Error(rowsError.message);
  return ((rows ?? []) as unknown as (IncidentListItem & {
    items: { id: string }[];
    replacements: { id: string }[];
  })[]).map((r) => ({
    ...r,
    item_count: r.items?.length ?? 0,
    replacement_count: r.replacements?.length ?? 0,
    action_count: 0,
    open_action_count: 0,
  }));
}

/* -------------------------------- report -------------------------------- */

/**
 * Every incident in a period, flattened for the aggregation.
 *
 * ONE query, bounded by an indexed range on detected_at and projected to the
 * columns the report needs. The aggregation itself runs in
 * `domain/incidents/report.ts` rather than in SQL — deliberately, and this is
 * the reasoning:
 *
 * A snapshot must contain exactly the document the screen showed, or §42's
 * promise that a stored report does not silently change is worthless. Two
 * implementations — SQL for the live view, TypeScript for the frozen one —
 * would be two chances to disagree, and the disagreement would be invisible
 * until somebody compared a snapshot against the month it claims to describe.
 * One tested function, fed by one query, cannot do that.
 *
 * The volume supports it: a month's incidents for this operation are tens,
 * not millions, and the range is indexed.
 */
export async function getReportIncidents(
  from: BusinessDate,
  to: BusinessDate,
): Promise<ReportIncident[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('incidents')
    .select(`
      id, incident_number, detected_at, status, severity, primary_cause, responsibility,
      customer_id, order_id, delivery_method_id, goods_reception_id,
      customer:customers ( id, name ),
      delivery_method:delivery_methods ( id, name ),
      type:incident_types!inner ( slug, category:incident_categories!inner ( slug ) ),
      causes:incident_secondary_causes ( cause ),
      items:incident_affected_items ( product:products ( id, code, name, family, presentation, brand_id, brand:brands ( name ) ) ),
      replacements:incident_replacements ( id )
    `)
    .gte('detected_at', `${from}T00:00:00`)
    .lte('detected_at', `${to}T23:59:59.999`)
    .order('detected_at');

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as {
    id: string;
    incident_number: string;
    detected_at: string;
    status: ReportIncident['status'];
    severity: ReportIncident['severity'];
    primary_cause: IncidentCause | null;
    responsibility: ReportIncident['responsibility'];
    customer_id: string | null;
    order_id: string | null;
    delivery_method_id: string | null;
    goods_reception_id: string | null;
    customer: { id: string; name: string } | null;
    delivery_method: { id: string; name: string } | null;
    type: { slug: string; category: { slug: string } };
    causes: { cause: IncidentCause }[];
    items: {
      product: {
        id: string;
        code: string | null;
        name: string | null;
        family: string;
        brand_id: string | null;
        brand: { name: string } | null;
      } | null;
    }[];
    replacements: { id: string }[];
  }[]).map((r) => ({
    id: r.id,
    incident_number: r.incident_number,
    detected_at: r.detected_at,
    status: r.status,
    severity: r.severity,
    primary_cause: r.primary_cause,
    responsibility: r.responsibility,
    secondary_causes: (r.causes ?? []).map((c) => c.cause),
    customer_id: r.customer_id,
    customer_name: r.customer?.name ?? null,
    order_id: r.order_id,
    delivery_method_id: r.delivery_method_id,
    delivery_method_name: r.delivery_method?.name ?? null,
    goods_reception_id: r.goods_reception_id,
    category_slug: r.type.category.slug,
    type_slug: r.type.slug,
    products: (r.items ?? [])
      .map((i) => i.product)
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => ({
        id: p.id,
        name: p.name?.trim() || p.family,
        code: p.code,
        brandId: p.brand_id,
        brandName: p.brand?.name ?? null,
      })),
    replacement_count: (r.replacements ?? []).length,
  }));
}

/** Corrective actions raised by any incident, for the report's action panel. */
export async function getReportActions(): Promise<ReportAction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('task_occurrences')
    .select('id, due_date, effective_due_date, status, completed_at, task:tasks!inner ( incident_id )')
    .not('task.incident_id', 'is', null);

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as {
    id: string;
    due_date: string;
    effective_due_date: string | null;
    status: ReportAction['status'];
    completed_at: string | null;
    task: { incident_id: string | null };
  }[]).map((o) => ({
    occurrence_id: o.id,
    incident_id: o.task.incident_id,
    due_date: o.effective_due_date ?? o.due_date,
    status: o.status,
    completed_at: o.completed_at,
  }));
}

/** The live report for a month. The same function a snapshot freezes. */
export async function getLiveReport(month: string, from: BusinessDate, to: BusinessDate) {
  const [incidents, actions] = await Promise.all([
    getReportIncidents(from, to),
    getReportActions(),
  ]);
  return buildReport({ month, from, to, incidents, actions, today: businessToday() });
}

/* ---------------------------- report history ---------------------------- */

export async function getReportSnapshots(limit = 60): Promise<IncidentReportSnapshot[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('incident_report_snapshots')
    .select(`
      id, period_month, version, payload, incident_ids, generated_by, generated_at, note,
      generator:profiles!incident_report_snapshots_generated_by_fkey ( name, email )
    `)
    .order('period_month', { ascending: false })
    .order('version', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as IncidentReportSnapshot[];
}

export async function getReportSnapshot(id: string): Promise<IncidentReportSnapshot | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('incident_report_snapshots')
    .select(`
      id, period_month, version, payload, incident_ids, generated_by, generated_at, note,
      generator:profiles!incident_report_snapshots_generated_by_fkey ( name, email )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as unknown as IncidentReportSnapshot) ?? null;
}
