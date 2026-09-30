/** Collections (Cobranza): following up unpaid invoices. */

export type CollectionStage = 'follow_up' | 'promise' | 'paid' | 'agency' | 'paid_agency' | 'uncollectible';
export const OPEN_COLLECTION_STAGES: CollectionStage[] = ['follow_up', 'promise', 'agency'];

export interface CollectionCaseRow {
  id: string;
  customer_id: string;
  customer_name: string;
  responsible_id: string | null;
  responsible_name: string | null;
  stage: CollectionStage;
  promised_on: string | null;
  next_follow_up: string | null;
  agency_id: string | null;
  agency_name: string | null;
  agency_sent_on: string | null;
  agency_reference: string | null;
  note: string | null;
  closed_at: string | null;
  created_at: string;
  /** CHF: invoiced, paid, still open. */
  total: number;
  paid: number;
  open: number;
  /** The oldest invoice's due date. */
  oldest_due: string | null;
}

export interface CollectionInvoice {
  id: string;
  invoice_number: string;
  due_date: string | null;
  amount: number;
}

export interface CollectionPayment {
  id: string;
  paid_on: string;
  amount: number;
  via_agency: boolean;
  note: string | null;
}

export type CollectionEventKind = 'call' | 'email' | 'note' | 'promise' | 'payment' | 'stage' | 'agency' | 'invoice' | 'responsible';

export interface CollectionEvent {
  id: number;
  kind: CollectionEventKind;
  happened_on: string;
  body: string | null;
  detail: Record<string, unknown>;
  author: string | null;
  created_at: string;
}

export interface CollectionAgency {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}
