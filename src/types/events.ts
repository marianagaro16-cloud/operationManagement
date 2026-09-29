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
