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

/** Someone covering an absent person, on one day, from–until. */
export interface CoverageAssignment {
  id: string;
  absence_id: string;
  coverer_id: string;
  coverer_name: string;
  cover_date: string;
  start_time: string;
  end_time: string;
  note: string | null;
  /** Permissions given with this period: active for its coverer exactly during it. */
  permissions: string[];
}

/** A period with who is away and who covers — the calendar's and the dashboard's. */
export interface CoverageEntry extends CoverageAssignment {
  absent_profile_id: string;
  absent_name: string;
}

export type HandoverLinkType =
  | 'customer' | 'order' | 'incident' | 'task' | 'personal_task' | 'reminder' | 'goods_reception' | 'inventory' | 'product';
export const HANDOVER_LINK_TYPES: HandoverLinkType[] = [
  'customer', 'order', 'incident', 'goods_reception', 'inventory', 'product', 'task', 'reminder', 'personal_task',
];

/** Something the people covering should know; maybe about one existing record. */
export interface HandoverItem {
  id: string;
  absence_id: string;
  title: string;
  body: string | null;
  link_type: HandoverLinkType | null;
  link_id: string | null;
  /** The record's name when it was linked — all a covering person sees of a private one. */
  link_label: string | null;
  status: 'open' | 'in_progress' | 'done';
  coverer_note: string | null;
  updated_at: string;
  updater_name: string | null;
}

/** Something of the absent person's that falls in the absence — offered for the handover. */
export interface HandoverSuggestion {
  type: HandoverLinkType;
  id: string;
  label: string;
}
