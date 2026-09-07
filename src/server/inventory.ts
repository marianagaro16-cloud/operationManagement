import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isPastEditDeadline } from '@/domain/inventory/calc';
import { addDays, businessToday, type BusinessDate } from '@/lib/datetime';
import { getViewer } from './data';
import { bucketByDay, OVERDUE_LOOKBACK_DAYS } from '@/domain/buckets';
import type {
  InventoryDetail,
  InventoryEditGrant,
  InventoryInstance,
  InventoryItemDetail,
  InventoryListRow,
  InventoryLocation,
  InventoryStatus,
  InventoryTemplate,
  InventoryTemplateItem,
} from '@/types/inventory';

/**
 * Server-side inventory data access.
 *
 * The UI layer never queries the database and never performs schedule or
 * reconciliation maths — same rule as the rest of the app. Anything a screen
 * needs to decide (can I edit this? is a digital value outstanding?) is
 * answered here, on the server, and for `can_edit` by asking the database
 * function that RLS itself uses.
 */

/* ------------------------------ generation ----------------------------- */

/*
 * There is none any more.
 *
 * Inventories used to materialise from a template schedule, filling four
 * months ahead. They are now placed deliberately from the calendar, like
 * every task except the daily checklist — see src/server/planning-actions.ts.
 *
 * The pure generator in src/domain/inventory/schedule.ts is kept, tested and
 * correct; it simply has no caller. UNIQUE(template_id, inventory_date) still
 * guarantees one inventory per template per date, which now constrains a
 * person rather than a rule.
 */

/* ------------------------------- overview ------------------------------ */

const LIST_SELECT = `
  id, template_id, inventory_date, iso_week, iso_year, period_key,
  name_snapshot, kind, digital_enabled, status, completed_at, completed_by,
  created_at, updated_at,
  template:inventory_templates ( id, slug, name, translations ),
  assignments:inventory_assignments ( user:profiles!inventory_assignments_user_id_fkey ( id, name, email ) ),
  completed_by_profile:profiles!inventory_instances_completed_by_fkey ( id, name, email ),
  items:inventory_instance_items ( id, status, digital_quantity )
`;

export interface InventoryFilters {
  templateId?: string;
  status?: InventoryStatus;
  isoWeek?: number;
  isoYear?: number;
  from?: BusinessDate;
  to?: BusinessDate;
  assignedUserId?: string;
  /** Only inventories where an admin still owes a digital value. */
  digitalPending?: boolean;
  /** Only inventories carrying at least one unreconciled difference. */
  needsReview?: boolean;
  limit?: number;
  offset?: number;
}

interface RawListRow extends InventoryInstance {
  template: InventoryListRow['template'];
  assignments: { user: { id: string; name: string | null; email: string } | null }[] | null;
  completed_by_profile: InventoryListRow['completed_by_profile'];
  items: { id: string; status: InventoryStatus; digital_quantity: number | null }[] | null;
}

function shapeListRow(row: RawListRow): InventoryListRow {
  const items = row.items ?? [];
  return {
    ...row,
    assignees: (row.assignments ?? [])
      .map((a) => a.user)
      .filter((u): u is NonNullable<typeof u> => u !== null),
    item_count: items.length,
    review_count: items.filter((i) => i.status === 'to_review').length,
    // Only meaningful when the template uses Inventory Digital at all.
    digital_pending_count: row.digital_enabled
      ? items.filter((i) => i.digital_quantity === null).length
      : 0,
  };
}

/**
 * Paged, filtered inventory list.
 *
 * History grows without bound, so this never fetches "everything" — the
 * caller always gets a page, and the filters are applied in the query rather
 * than in the browser.
 */
export async function getInventories(
  filters: InventoryFilters = {},
): Promise<{ rows: InventoryListRow[]; total: number }> {
  const supabase = createClient();
  const limit = Math.min(filters.limit ?? 25, 100);
  const offset = filters.offset ?? 0;

  // Filtering on a joined table only restricts the PARENT rows when the join
  // is !inner, so the select string is chosen before the query is built —
  // reassigning `query` to a differently-typed builder is what the Supabase
  // types (rightly) refuse.
  const select = filters.assignedUserId
    ? LIST_SELECT.replace(
        'assignments:inventory_assignments (',
        'assignments:inventory_assignments!inner (',
      )
    : LIST_SELECT;

  let query = supabase
    .from('inventory_instances')
    .select(select, { count: 'exact' })
    .order('inventory_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.templateId) query = query.eq('template_id', filters.templateId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.isoWeek) query = query.eq('iso_week', filters.isoWeek);
  if (filters.isoYear) query = query.eq('iso_year', filters.isoYear);
  if (filters.from) query = query.gte('inventory_date', filters.from);
  if (filters.to) query = query.lte('inventory_date', filters.to);
  if (filters.assignedUserId) {
    query = query.eq('inventory_assignments.user_id', filters.assignedUserId);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  let rows = ((data ?? []) as unknown as RawListRow[]).map(shapeListRow);

  // Applied after shaping because both are aggregates over the child rows the
  // query already returned; re-querying to express them in SQL would cost a
  // second round trip for no benefit at this page size.
  if (filters.digitalPending) rows = rows.filter((r) => r.digital_pending_count > 0);
  if (filters.needsReview) rows = rows.filter((r) => r.review_count > 0);

  return { rows, total: count ?? rows.length };
}

/** Today's and the next `days` inventories — the operator's working view. */
export async function getInventoryDashboard(days = 14): Promise<{
  today: BusinessDate;
  dueToday: InventoryListRow[];
  overdue: InventoryListRow[];
  upcoming: InventoryListRow[];
  needsReview: InventoryListRow[];
  digitalPending: InventoryListRow[];
}> {
  const today = businessToday();

  // Reads only. Materialising inventories is the scheduler's job — see
  // server/scheduling.ts — so this function returns the same thing whether it
  // is called from the dashboard or from the inventory screen.
  const [live, review] = await Promise.all([
    getInventories({ from: addDays(today, -OVERDUE_LOOKBACK_DAYS), to: addDays(today, days), limit: 100 }),
    getInventories({ to: today, limit: 100 }),
  ]);

  // The same bucketing the task dashboard uses. Only the two things that
  // genuinely differ per module are supplied here: which date an item is due
  // on, and what counts as unfinished.
  const buckets = bucketByDay(live.rows, today, {
    dateOf: (r) => r.inventory_date,
    isOpen: (r) => r.status === 'in_progress',
  });

  return {
    today,
    dueToday: buckets.today,
    overdue: buckets.overdue,
    upcoming: buckets.upcoming,
    needsReview: review.rows.filter((r) => r.review_count > 0),
    digitalPending: review.rows.filter((r) => r.digital_pending_count > 0),
  };
}

/* -------------------------------- detail ------------------------------- */

const DETAIL_ITEM_SELECT = `
  id, instance_id, template_item_id, item_name, item_group, item_sort_order,
  product_id, physical_stock, digital_quantity, difference, status,
  is_resolved, resolved_at, resolved_by, created_at, updated_at,
  entries:inventory_entries (
    id, instance_item_id, instance_id, quantity, expiry_date, lot_number,
    location_id, location_name, note, position, created_by, updated_by,
    created_at, updated_at
  ),
  comments:inventory_comments (
    id, instance_id, instance_item_id, user_id, body, created_at,
    author:profiles ( id, name, email )
  ),
  resolutions:inventory_resolutions (
    id, instance_item_id, instance_id, note, physical_stock_at, digital_at,
    difference_at, resolved_by, resolved_at, superseded_at,
    author:profiles ( id, name, email )
  ),
  digital_history:inventory_digital_history (
    id, instance_item_id, instance_id, previous_digital, new_digital,
    physical_stock_at, previous_difference, new_difference, changed_by, changed_at,
    author:profiles ( id, name, email )
  )
`;

export async function getInventoryDetail(instanceId: string): Promise<InventoryDetail | null> {
  const supabase = createClient();
  const viewer = await getViewer();
  const profile = viewer?.profile ?? null;

  const { data, error } = await supabase
    .from('inventory_instances')
    .select(`
      id, template_id, inventory_date, iso_week, iso_year, period_key,
      name_snapshot, kind, digital_enabled, status, completed_at, completed_by,
      created_at, updated_at,
      template:inventory_templates ( * ),
      assignments:inventory_assignments ( user:profiles!inventory_assignments_user_id_fkey ( id, name, email ) ),
      completed_by_profile:profiles!inventory_instances_completed_by_fkey ( id, name, email ),
      items:inventory_instance_items ( ${DETAIL_ITEM_SELECT} ),
      comments:inventory_comments ( id, instance_id, instance_item_id, user_id, body, created_at, author:profiles ( id, name, email ) )
    `)
    .eq('id', instanceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const raw = data as unknown as InventoryInstance & {
    template: InventoryTemplate | null;
    assignments: { user: { id: string; name: string | null; email: string } | null }[] | null;
    completed_by_profile: InventoryDetail['completed_by_profile'];
    items: InventoryItemDetail[] | null;
    comments: InventoryDetail['general_comments'] | null;
  };

  // The one authority on whether this user may write: the same SECURITY
  // DEFINER function the RLS policies call. Recomputing the rule in
  // TypeScript would let the UI and the database disagree.
  const { data: canEdit } = await supabase.rpc('inventory_can_edit', {
    p_instance_id: instanceId,
  });

  const assignees = (raw.assignments ?? [])
    .map((a) => a.user)
    .filter((u): u is NonNullable<typeof u> => u !== null);

  const { data: grants } = await supabase
    .from('inventory_edit_grants')
    .select('*')
    .eq('user_id', profile?.id ?? '')
    .is('revoked_at', null)
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', new Date().toISOString());

  const activeGrant =
    ((grants ?? []) as InventoryEditGrant[]).find(
      (g) => g.scope === 'all' || g.instance_id === instanceId,
    ) ?? null;

  const items = (raw.items ?? [])
    .slice()
    .sort((a, b) => a.item_sort_order - b.item_sort_order || a.item_name.localeCompare(b.item_name))
    .map((item) => ({
      ...item,
      entries: (item.entries ?? []).slice().sort((a, b) => a.position - b.position),
    }));

  return {
    ...raw,
    template: raw.template,
    assignees,
    items,
    // Comments with no item attached are the inventory-level thread.
    general_comments: (raw.comments ?? []).filter((c) => c.instance_item_id === null),
    can_edit: Boolean(canEdit),
    lock_reason: lockReason({
      canEdit: Boolean(canEdit),
      canManage: viewer?.can('inventory.manage_instances') ?? false,
      approved: profile?.status === 'approved',
      assigned: assignees.some((a) => a.id === profile?.id),
      completed: raw.completed_at !== null,
      pastDeadline: isPastEditDeadline(raw.inventory_date),
    }),
    active_grant: activeGrant,
  };
}

/** Explains a read-only screen, so it can say why rather than just look broken. */
function lockReason(input: {
  canEdit: boolean;
  canManage: boolean;
  approved: boolean;
  assigned: boolean;
  completed: boolean;
  pastDeadline: boolean;
}): InventoryDetail['lock_reason'] {
  if (input.canEdit) return 'none';
  if (!input.approved) return 'not_approved';
  if (!input.assigned && !input.canManage) return 'not_assigned';
  if (input.completed) return 'completed';
  if (input.pastDeadline) return 'past_deadline';
  return 'not_assigned';
}

/* ---------------------------- admin: config ---------------------------- */

export async function getInventoryTemplates(): Promise<
  (InventoryTemplate & { item_count: number; assignee_ids: string[] })[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('inventory_templates')
    .select('*, items:inventory_template_items ( id, is_active ), assignees:inventory_template_assignees ( user_id )')
    .order('name');

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as (InventoryTemplate & {
    items: { id: string; is_active: boolean }[] | null;
    assignees: { user_id: string }[] | null;
  })[]).map((t) => ({
    ...t,
    item_count: (t.items ?? []).filter((i) => i.is_active).length,
    assignee_ids: (t.assignees ?? []).map((a) => a.user_id),
  }));
}

export async function getInventoryTemplate(templateId: string): Promise<
  | (InventoryTemplate & {
      items: (InventoryTemplateItem & { product: { id: string; name: string | null; code: string | null } | null })[];
      assignee_ids: string[];
    })
  | null
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('inventory_templates')
    .select(`
      *,
      items:inventory_template_items ( *, product:products ( id, name, code ) ),
      assignees:inventory_template_assignees ( user_id )
    `)
    .eq('id', templateId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const raw = data as unknown as InventoryTemplate & {
    items: (InventoryTemplateItem & { product: { id: string; name: string | null; code: string | null } | null })[] | null;
    assignees: { user_id: string }[] | null;
  };

  return {
    ...raw,
    items: (raw.items ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    assignee_ids: (raw.assignees ?? []).map((a) => a.user_id),
  };
}

export async function getInventoryLocations(includeInactive = false): Promise<InventoryLocation[]> {
  const supabase = createClient();
  let query = supabase.from('inventory_locations').select('*').order('sort_order').order('name');
  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as InventoryLocation[];
}

/* ---------------------------- admin: grants ---------------------------- */

export async function getEditGrants(): Promise<
  (InventoryEditGrant & {
    user: { id: string; name: string | null; email: string } | null;
    instance: { id: string; name_snapshot: string; inventory_date: string } | null;
  })[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('inventory_edit_grants')
    .select(`
      *,
      user:profiles!inventory_edit_grants_user_id_fkey ( id, name, email ),
      instance:inventory_instances ( id, name_snapshot, inventory_date )
    `)
    .order('starts_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Awaited<ReturnType<typeof getEditGrants>>;
}

/* ------------------------------ reporting ------------------------------ */

export interface InventoryReport {
  totals: Record<InventoryStatus, number>;
  digitalPending: number;
  unresolvedDifferences: number;
  resolvedDifferences: number;
  byTemplate: { templateId: string; name: string; count: number; reviews: number }[];
}

/**
 * Operational reporting, deliberately narrow: what still needs someone's
 * attention, and what happened. Not an analytics suite.
 */
export async function getInventoryReport(
  from: BusinessDate,
  to: BusinessDate,
): Promise<InventoryReport> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('inventory_instances')
    .select(`
      id, template_id, status, digital_enabled, name_snapshot,
      items:inventory_instance_items ( status, digital_quantity, is_resolved )
    `)
    .gte('inventory_date', from)
    .lte('inventory_date', to);

  if (error) throw new Error(error.message);

  const totals: Record<InventoryStatus, number> = {
    in_progress: 0,
    completed: 0,
    to_review: 0,
    resolved: 0,
  };
  let digitalPending = 0;
  let unresolvedDifferences = 0;
  let resolvedDifferences = 0;
  const byTemplate = new Map<string, { templateId: string; name: string; count: number; reviews: number }>();

  for (const row of (data ?? []) as unknown as {
    id: string;
    template_id: string;
    status: InventoryStatus;
    digital_enabled: boolean;
    name_snapshot: string;
    items: { status: InventoryStatus; digital_quantity: number | null; is_resolved: boolean }[] | null;
  }[]) {
    totals[row.status] += 1;
    const items = row.items ?? [];
    const reviews = items.filter((i) => i.status === 'to_review').length;
    unresolvedDifferences += reviews;
    resolvedDifferences += items.filter((i) => i.is_resolved).length;
    if (row.digital_enabled && items.some((i) => i.digital_quantity === null)) digitalPending += 1;

    const entry = byTemplate.get(row.template_id) ?? {
      templateId: row.template_id,
      name: row.name_snapshot,
      count: 0,
      reviews: 0,
    };
    entry.count += 1;
    entry.reviews += reviews;
    byTemplate.set(row.template_id, entry);
  }

  return {
    totals,
    digitalPending,
    unresolvedDifferences,
    resolvedDifferences,
    byTemplate: [...byTemplate.values()].sort((a, b) => b.count - a.count),
  };
}
