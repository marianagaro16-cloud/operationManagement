/** Sales: the customer file and its notes. Quantities and kg only — there are no prices. */

export const NOTE_KINDS = ['call', 'visit', 'message', 'offer'] as const;
export type CustomerNoteKind = (typeof NOTE_KINDS)[number];

export interface SalesCustomerRow {
  id: string;
  company_name: string;
  company_name_addition: string | null;
  city: string | null;
  is_active: boolean;
  last_order: string | null;
  orders_90d: number;
  notes: number;
}

export interface Amount {
  quantity: number;
  kg: number;
}

export interface SalesCustomerFile {
  customer: {
    id: string;
    company_name: string;
    company_name_addition: string | null;
    name: string | null;
    street: string | null;
    postal_code: string | null;
    city: string | null;
    is_active: boolean;
    type: string | null;
  };
  orders: { total: number; first: string | null; last: string | null; next: string | null };
  /** Average days between the days they received an order; null before two. */
  rhythm_days: number | null;
  periods: { last30: Amount; prev30: Amount };
  top_products: { id: string; code: string | null; name: string; quantity: number; kg: number | null; orders: number }[];
  recent_orders: { id: string; reference: number; delivery_date: string; lines: number; quantity: number; kg: number }[];
  incidents: { id: string; incident_number: number; created_at: string; status: string; description: string | null }[];
}

export interface CustomerNote {
  id: string;
  kind: CustomerNoteKind;
  note_date: string;
  body: string;
  created_at: string;
  author_name: string | null;
}

/** An open follow-up — a reminder linked to the customer, the viewer's own. */
export interface CustomerFollowUp {
  id: string;
  title: string;
  next_at: string;
}
