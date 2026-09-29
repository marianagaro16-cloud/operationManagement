/** Sales: the customer file and its notes. Quantities and kg only — there are no prices. */

/** The icons a kind can wear. */
export const KIND_ICONS = ['phone', 'calendar', 'mail', 'map-pin', 'message-circle', 'tag', 'star', 'file-text', 'circle'] as const;
export type KindIcon = (typeof KIND_ICONS)[number];

/**
 * A kind of sales activity — call, appointment, email, visit, WhatsApp… —
 * Admin's list, shared by the planning and the notes. 'visit' goes on the
 * route; 'appointment' has a place; the rest are 'plain'.
 */
export interface ActivityKind {
  id: string;
  slug: string;
  name: string;
  translations: Record<string, { name?: string | null }>;
  icon: KindIcon;
  behavior: 'plain' | 'visit' | 'appointment';
  /** How long it usually takes: fills the end in when a start is set. */
  default_minutes: number;
  sort_order: number;
  is_active: boolean;
}

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
  kind_id: string;
  note_date: string;
  body: string;
  created_at: string;
  author_name: string | null;
}

/** A customer going quiet: late against their rhythm, ordering less, or both. */
export interface QuietCustomer {
  id: string;
  company_name: string;
  company_name_addition: string | null;
  city: string | null;
  last_order: string;
  rhythm_days: number;
  days_since: number;
  late: boolean;
  last30: number;
  prev30: number;
  /** Last 30 days against the 30 before, in %; null without the 30 before. */
  change_pct: number | null;
}

/* ------------------------------- prospects ------------------------------- */

export const PROSPECT_STAGES = ['new', 'contacted', 'tasting', 'offer', 'won', 'lost'] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];
/** The stages a prospect moves through by hand; won and lost have their own actions. */
export const OPEN_STAGES = ['new', 'contacted', 'tasting', 'offer'] as const satisfies readonly ProspectStage[];

/** An entry of Admin's lists — how we found a prospect, or why one was lost. */
export interface ProspectListEntry {
  id: string;
  name: string;
  /** German and English overrides; Spanish is in `name`. */
  translations: Record<string, { name?: string | null }>;
  sort_order: number;
  is_active: boolean;
}

export interface Prospect {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  customer_type_id: string | null;
  source_id: string | null;
  interest: string | null;
  weekly_volume: string | null;
  stage: ProspectStage;
  owner_id: string | null;
  owner_name: string | null;
  lost_reason_id: string | null;
  lost_note: string | null;
  customer_id: string | null;
  closed_at: string | null;
  created_at: string;
  /** The soonest activity still planned with them; null when nothing is — which needs fixing. */
  next: { kind_id: string; date: string; time: string | null; end: string | null; title: string | null } | null;
}

export interface ProspectNote {
  id: string;
  kind_id: string;
  note_date: string;
  body: string;
  created_at: string;
  author_name: string | null;
}

/* --------------------------------- report -------------------------------- */

export interface SalesReportLine {
  id: string | null;
  name: string;
  code?: string | null;
  city?: string | null;
  customers?: number;
  quantity: number;
  kg: number;
  prev_quantity: number;
  prev_kg: number;
}

/** A month against the one before (the same days, while it is running). Units and net kg. */
export interface SalesReport {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  totals: { quantity: number; kg: number; prev_quantity: number; prev_kg: number; customers: number };
  customers: SalesReportLine[];
  products: SalesReportLine[];
  types: SalesReportLine[];
  trend: { month: string; quantity: number; kg: number }[];
}

/* -------------------------------- planning ------------------------------- */

export type ActivityStatus = 'planned' | 'done' | 'not_done';
/** Where an appointment takes place. */
export type AppointmentPlace = 'theirs' | 'office' | 'online' | 'other';

/** Who an activity is about: a customer or a prospect, with where they are. */
export interface VisitTarget {
  kind: 'customer' | 'prospect';
  id: string;
  name: string;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** A planned sales activity: a call, an appointment, a visit… on a day, maybe at a time. */
export interface SalesActivity {
  id: string;
  salesperson_id: string;
  kind_id: string;
  activity_date: string;
  activity_time: string | null;
  /** Until when; only with a start. */
  activity_end: string | null;
  title: string | null;
  place: AppointmentPlace | null;
  place_detail: string | null;
  position: number;
  status: ActivityStatus;
  /** About a customer or a prospect; null for a free one. */
  target: VisitTarget | null;
  /** The event it is a task of, if any. */
  event: { id: string; name: string } | null;
}

/** Where a salesperson's day starts and ends. */
export interface StartPoint {
  street: string | null;
  postal_code: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Where a day of visits starts and where it ends. */
export type DayEnd = 'home' | 'office';
export interface DayEnds {
  start_at: DayEnd;
  end_at: DayEnd;
}
