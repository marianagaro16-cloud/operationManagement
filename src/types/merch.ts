/*
 * Merch: items with stock, campaigns ("week X, pens to Gastro"), and the merch
 * each order carries. See supabase/migrations/20270115090000_merch.sql.
 */

export type MerchPacking = 'open' | 'packed' | 'not_sent';
export type MerchNotSentReason = 'none_left' | 'declined' | 'forgot' | 'other';
export const MERCH_REASONS: MerchNotSentReason[] = ['none_left', 'declined', 'forgot', 'other'];

/** Where one customer's merch of one campaign stands. Derived, never stored. */
export type MerchLineStatus = 'waiting' | 'on_order' | 'packed' | 'sent' | 'not_sent' | 'expired';

export interface MerchItem {
  id: string;
  name: string;
  note: string | null;
  is_active: boolean;
}

export interface MerchStock {
  item_id: string;
  received: number;
  sent: number;
  handed: number;
  promised: number;
}

export interface MerchItemRow extends MerchItem {
  stock: number;
  promised: number;
}

/** The merch an order carries, on its preparation card and its page. */
export interface OrderMerchLine {
  id: string;
  quantity: number;
  packing: MerchPacking;
  not_sent_reason: MerchNotSentReason | null;
  not_sent_note: string | null;
  packed_at: string | null;
  campaign: { id: string; week_start: string; item: { id: string; name: string } | null } | null;
  packer?: { name: string | null; email: string } | null;
}

export interface MerchCampaignRow {
  id: string;
  item_id: string;
  item_name: string;
  week_start: string;
  deadline: string;
  quantity: number;
  carry_weeks: number;
  customer_type_ids: string[];
  note: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  creator_name: string | null;
  counts: Record<MerchLineStatus, number>;
}

export interface MerchCampaignLine {
  id: string;
  customer_id: string;
  customer_name: string;
  quantity: number;
  status: MerchLineStatus;
  packing: MerchPacking;
  not_sent_reason: MerchNotSentReason | null;
  not_sent_note: string | null;
  order: { id: string; reference: number; delivery_date: string; shipped_at: string | null; ready_at: string | null } | null;
}

/** One thing a customer received or was meant to — for the customer file and the item page. */
export interface MerchHistoryEntry {
  /** 'campaign' lines carry an order; 'handout' was given in person. */
  source: 'campaign' | 'handout';
  id: string;
  date: string;
  item_id: string;
  item_name: string;
  customer_id: string;
  customer_name: string;
  quantity: number;
  status: MerchLineStatus;
  not_sent_reason: MerchNotSentReason | null;
  note: string | null;
  campaign_id: string | null;
  order: { id: string; reference: number } | null;
  by: string | null;
}

export interface MerchStockEntry {
  id: string;
  quantity: number;
  entry_date: string;
  note: string | null;
  by: string | null;
}

/** For a new order: merch waiting for this customer, and the window it fits. */
export interface PendingMerch {
  id: string;
  item_name: string;
  quantity: number;
  week_start: string;
  deadline: string;
}

/** Who a campaign may go to: active customers with their type. */
export interface MerchCustomerOption {
  id: string;
  name: string;
  customer_type_id: string | null;
}
