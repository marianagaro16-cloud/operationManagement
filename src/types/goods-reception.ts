/**
 * Goods Reception types. Mirrors the SQL in
 * 20260920090000_goods_reception_module.sql. Regenerate the authoritative
 * version with `npm run db:types`.
 */
import type {
  QuantityCheck,
  ReceptionCondition,
  ReceptionStatus,
} from '@/domain/goods-reception/vocabulary';
import type { Product } from './orders';

export type { QuantityCheck, ReceptionCondition, ReceptionStatus };

/** Who goods came FROM. */
export interface Supplier {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Who CARRIED the goods to us.
 *
 * Separate from `DeliveryMethod`, which is how goods leave us for a customer.
 * The same company can appear on both sides and they remain different facts.
 */
export interface Transporter {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReceptionException {
  id: string;
  reception_id: string;
  product_id: string;
  lot_number: string | null;
  /** MHD / best-before, ISO date. */
  best_before: string | null;
  /** numeric(12,3): arrives from Postgres as a string. */
  affected_quantity: number | string | null;
  description: string;
  created_by: string | null;
  created_at: string;
  product?: Product;
  /** Photos attached to this specific exception. */
  evidence?: ReceptionEvidence[];
}

export interface ReceptionEvidence {
  id: string;
  reception_id: string;
  exception_id: string | null;
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

/** One incident raised against a reception, as the detail page lists it. */
export interface LinkedIncident {
  id: string;
  incident_number: string;
  description: string;
  severity: string;
  status: string;
  detected_at: string;
  type?: { slug: string; name: string } | null;
}

export interface GoodsReception {
  id: string;
  reference: number;
  reception_number: string;
  supplier_id: string | null;
  transporter_id: string | null;
  delivery_note: string | null;
  received_at: string;
  received_by: string;
  condition: ReceptionCondition | null;
  quantity_check: QuantityCheck;
  comments: string | null;
  status: ReceptionStatus;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;

  supplier?: Supplier | null;
  transporter?: Transporter | null;
  receiver?: { id: string; name: string | null; email: string } | null;
}

/** A row of the list screen: the reception plus the counts it is judged by. */
export interface ReceptionListItem extends GoodsReception {
  exception_count: number;
  incident_count: number;
}

export interface ReceptionDetail extends GoodsReception {
  exceptions: ReceptionException[];
  evidence: ReceptionEvidence[];
  incidents: LinkedIncident[];
  completer?: { name: string | null; email: string } | null;
}

export interface ReceptionAuditEntry {
  id: string;
  reception_id: string | null;
  actor_id: string | null;
  action: string;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
  actor?: { name: string | null; email: string } | null;
}

/**
 * List filters. Every one of them is applied in SQL — §54 forbids pulling
 * thousands of receptions into the browser to filter them there.
 */
export interface ReceptionFilters {
  /** Reception number, delivery note, or comment text. */
  search?: string;
  from?: string;
  to?: string;
  supplierId?: string;
  transporterId?: string;
  receivedBy?: string;
  condition?: ReceptionCondition;
  quantityCheck?: QuantityCheck;
  status?: ReceptionStatus;
  /** 'with' | 'without' — receptions carrying linked incidents. */
  incidents?: 'with' | 'without';
}

export interface ReceptionPage {
  rows: ReceptionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** A frozen monthly report, exactly as it was generated. */
export interface ReceptionReportSnapshot {
  id: string;
  period_month: string;
  version: number;
  payload: unknown;
  reception_ids: string[];
  generated_by: string | null;
  generated_at: string;
  note: string | null;
  generator?: { name: string | null; email: string } | null;
}
