/** Events: fairs and markets, events with a customer, our own events. */

export type EventStage = 'idea' | 'confirmed' | 'done' | 'cancelled';

/** An entry of Admin's lists: event kinds, cost types. */
export interface EventListEntry {
  id: string;
  name: string;
  translations: Record<string, { name?: string | null }>;
  sort_order: number;
  is_active: boolean;
}

/** A kind's standard task: days from the start (negative: before), or after the end. */
export interface EventKindTask {
  id: string;
  kind_id: string;
  title: string;
  translations: Record<string, { name?: string | null }>;
  anchor: 'start' | 'end';
  days: number;
  sort_order: number;
}

export interface EventRow {
  id: string;
  kind_id: string;
  name: string;
  stage: EventStage;
  cancel_reason: string | null;
  start_date: string;
  end_date: string;
  open_time: string | null;
  close_time: string | null;
  place_name: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  customer_id: string | null;
  customer_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  description: string | null;
  /** When what we take goes; null until chosen: the day before the start. */
  delivery_date: string | null;
  delivery_method_id: string | null;
  order_id: string | null;
  /** How it went: asked for when it is marked done. */
  result_summary: string | null;
  result_rating: number | null;
  result_repeat: 'yes' | 'no' | 'maybe' | null;
  result_visitors: number | null;
  result_samples: number | null;
  result_contacts: number | null;
}

export interface EventNote {
  id: string;
  body: string;
  created_at: string;
  author: string | null;
}

export interface EventFile {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  /** Signed for an hour; null when signing failed. */
  url: string | null;
}

/** A prospect met at the event. */
export interface EventContact {
  id: string;
  company_name: string;
  contact_name: string | null;
  stage: string;
  customer_id: string | null;
}

/** The order made from an event. */
export interface EventOrder {
  id: string;
  reference: number;
  status: 'draft' | 'confirmed' | 'cancelled';
  ready_at: string | null;
  shipped_at: string | null;
  delivery_date: string;
  delivery_method_id: string;
}

/** What we take: the event's list while it has no order, the order's lines after. */
export interface EventProduct {
  product_id: string;
  quantity: number;
  note: string | null;
  /** What was prepared, once the order is ready; null before. */
  prepared: number | null;
}

/** Per product, after the event. */
export interface EventReturn {
  product_id: string;
  back_quantity: number;
  discarded_quantity: number;
}

export interface EventShift {
  id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  profile_id: string | null;
  hr_worker_id: string | null;
  /** Whoever works it: an account's name or a worker's. */
  person_name: string;
  note: string | null;
}

export interface EventCost {
  id: string;
  type_id: string;
  description: string | null;
  planned_amount: number | null;
  actual_amount: number | null;
}

/** Someone who can work at an event: an app user or a worker without an account. */
export interface StaffCandidate {
  kind: 'profile' | 'worker';
  id: string;
  name: string;
}
