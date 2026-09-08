/**
 * Incidents module types. Mirrors the SQL in
 * 20260911090100_incidents_module.sql. Regenerate the authoritative version
 * with `npm run db:types`.
 */
import type {
  IncidentCause,
  IncidentResponsibility,
  IncidentSeverity,
  IncidentStatus,
} from '@/domain/incidents/vocabulary';
import type { Customer, DeliveryMethod, Product } from './orders';

export type {
  IncidentCause,
  IncidentResponsibility,
  IncidentSeverity,
  IncidentStatus,
};

/** Configurable vocabulary. `slug` is the i18n key; `name` is the fallback. */
export interface IncidentCategory {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface IncidentType {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  category?: IncidentCategory;
}

export interface IncidentAffectedItem {
  id: string;
  incident_id: string;
  product_id: string;
  order_line_id: string | null;
  lot_allocation_id: string | null;
  /** numeric(12,3): arrives from Postgres as a string. */
  affected_quantity: number | string | null;
  note: string | null;
  position: number;
  product: Product;
  /**
   * The lot this item was prepared from, when preparation recorded one.
   * Read through the allocation — there is no second lot-number store.
   */
  lot_allocation?: { id: string; lot_number: string } | null;
}

export interface IncidentEvidence {
  id: string;
  incident_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
  uploader?: { name: string | null; email: string } | null;
  /** Minted per request; never stored. Absent until the detail page asks. */
  signed_url?: string | null;
}

/**
 * What we sent afterwards.
 *
 * Either a real replacement ORDER — which is picked, lot-numbered and traced
 * like any other delivery — or an off-order note for a compensation that
 * never became an order.
 */
export interface IncidentReplacement {
  id: string;
  incident_id: string;
  order_id: string | null;
  product_id: string | null;
  quantity: number | string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  order?: { id: string; reference: number; delivery_date: string; status: string } | null;
  product?: Product | null;
}

/**
 * A corrective action: an occurrence of a one-off task raised by an incident.
 * The task IS a task — there is no parallel action entity.
 */
export interface CorrectiveAction {
  occurrence_id: string;
  task_id: string;
  title: string;
  description: string | null;
  due_date: string;
  status: 'pending' | 'completed' | 'skipped';
  completed_at: string | null;
  assignee: { id: string; name: string | null; email: string } | null;
}

export interface IncidentHistoryEntry {
  id: string;
  action: string;
  created_at: string;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  actor: { id: string; name: string | null; email: string } | null;
}

/** The list row. Deliberately narrower than the detail. */
export interface IncidentListItem {
  id: string;
  incident_number: string;
  detected_at: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  primary_cause: IncidentCause | null;
  responsibility: IncidentResponsibility;
  customer_id: string | null;
  order_id: string | null;
  delivery_method_id: string | null;
  incident_type_id: string;
  customer: Pick<Customer, 'id' | 'name'> | null;
  order: { id: string; reference: number } | null;
  type: Pick<IncidentType, 'id' | 'slug' | 'name' | 'category_id'>;
  /** Counted in the query, not by loading the rows. */
  item_count: number;
  replacement_count: number;
  action_count: number;
  open_action_count: number;
}

export interface Incident {
  id: string;
  reference: number;
  incident_number: string;

  customer_id: string | null;
  order_id: string | null;
  delivery_method_id: string | null;
  incident_type_id: string;

  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;

  primary_cause: IncidentCause | null;
  responsibility: IncidentResponsibility;
  investigation_notes: string | null;
  resolution_notes: string | null;

  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;

  customer: Customer | null;
  /** The order, with the dates the incident prefilled itself from. */
  order: {
    id: string;
    reference: number;
    order_date: string;
    preparation_date: string;
    delivery_date: string;
    delivery_method_id: string | null;
  } | null;
  delivery_method: DeliveryMethod | null;
  type: IncidentType;

  items: IncidentAffectedItem[];
  secondary_causes: IncidentCause[];
  evidence: IncidentEvidence[];
  replacements: IncidentReplacement[];
  actions: CorrectiveAction[];
  history: IncidentHistoryEntry[];
}

/** Every filter the list and the export understand. All combinable. */
export interface IncidentFilters {
  from?: string;
  to?: string;
  customerId?: string;
  productId?: string;
  orderId?: string;
  categoryId?: string;
  typeId?: string;
  primaryCause?: IncidentCause;
  responsibility?: IncidentResponsibility;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  deliveryMethodId?: string;
  createdBy?: string;
  /** 'with' | 'without' — has a replacement been recorded? */
  replacement?: 'with' | 'without';
  /** 'none' | 'open' | 'done' — the state of its corrective actions. */
  action?: 'none' | 'open' | 'done';
  /** Free text over the incident number and the description. */
  q?: string;
}

export interface IncidentPage {
  rows: IncidentListItem[];
  /** Total matching the filters, for the pager. Not the page length. */
  total: number;
  page: number;
  pageSize: number;
}

export interface IncidentReportSnapshot {
  id: string;
  period_month: string;
  version: number;
  payload: import('@/domain/incidents/report').IncidentReportPayload;
  incident_ids: string[];
  generated_by: string | null;
  generated_at: string;
  note: string | null;
  generator?: { name: string | null; email: string } | null;
}
