/** Absences: someone with an account is away. Step 1 of Absence & Coverage. */

export type AbsenceStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
/** The first day may start in the afternoon. */
export type AbsenceFirstDay = 'full' | 'afternoon';
/** The last day may end at noon. */
export type AbsenceLastDay = 'full' | 'morning';

export interface AbsenceType {
  id: string;
  name: string;
  translations: Record<string, { name?: string | null }>;
  sort_order: number;
  is_active: boolean;
}

/** The whole absence: only the person and the approvers read one. */
export interface AbsenceRow {
  id: string;
  profile_id: string;
  person_name: string;
  type_id: string;
  start_date: string;
  end_date: string;
  first_day: AbsenceFirstDay;
  last_day: AbsenceLastDay;
  note: string | null;
  status: AbsenceStatus;
  decided_at: string | null;
  decider_name: string | null;
  rejection_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
}

/** Who is away and when — what everyone sees; no type, no note. */
export interface AbsenceCalendarEntry {
  id: string;
  profile_id: string;
  person_name: string;
  start_date: string;
  end_date: string;
  first_day: AbsenceFirstDay;
  last_day: AbsenceLastDay;
}

export interface AbsenceEvent {
  id: number;
  action: 'requested' | 'changed' | 'approved' | 'rejected' | 'cancelled';
  actor_name: string | null;
  created_at: string;
}
