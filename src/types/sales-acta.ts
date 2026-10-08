/** Sales: the Acta of a visit or an appointment with a customer or a prospect. */
import type { AgreementResult } from '@/domain/hr/note-structure';
import type { AppointmentPlace, ProspectListEntry } from './sales';

/** What a point is about: Admin's list, in three languages. */
export type ActaTopic = ProspectListEntry;

export interface ActaAttendee {
  id: string;
  /** Ours: someone with an account. Theirs: a name typed in. */
  side: 'ours' | 'theirs';
  profile_id: string | null;
  name: string;
  /** What they do there; theirs only. */
  role: string | null;
}

export interface ActaAgreement {
  id: string;
  body: string;
  responsible_profile_id: string | null;
  responsible_name: string | null;
  due_on: string | null;
  /** What each follow-up said of it, oldest first. */
  results: { entry_id: string; result: AgreementResult; comment: string | null }[];
}

export interface ActaPoint {
  id: string;
  topic_id: string | null;
  title: string;
  discussed: string | null;
  agreements: ActaAgreement[];
}

export interface ActaEntry {
  id: string;
  kind: 'addendum' | 'followup';
  entry_date: string;
  body: string;
  closes: boolean;
  next_on: string | null;
  created_at: string;
  author_name: string | null;
}

/** Who the meeting was with, as their file is reached. */
export interface ActaTarget {
  kind: 'customer' | 'prospect';
  id: string;
  name: string;
}

export interface SalesActa {
  activity_id: string;
  target: ActaTarget;
  kind_id: string;
  meeting_date: string;
  start_time: string | null;
  end_time: string | null;
  place: AppointmentPlace | null;
  place_detail: string | null;
  salesperson_id: string;
  salesperson_name: string;
  follow_up_on: string | null;
  /** Null: still a draft. */
  registered_at: string | null;
  registered_by_name: string | null;
  attendees: ActaAttendee[];
  points: ActaPoint[];
  entries: ActaEntry[];
}

/** The done visit or appointment an Acta belongs to — there before the Acta is. */
export interface ActaMeeting {
  activity_id: string;
  target: ActaTarget;
  /** The prospect's contact, to start the list of who was there. */
  contact_name: string | null;
  kind_id: string;
  meeting_date: string;
  start_time: string | null;
  end_time: string | null;
  place: AppointmentPlace | null;
  place_detail: string | null;
  salesperson_id: string;
  salesperson_name: string;
  /** Others of ours who took part. */
  participants: { id: string; name: string }[];
  /** Owed: its salesperson is chased until it is registered. */
  required: boolean;
}

/** pending: owed and not begun. draft: begun. registered: permanent. */
export type ActaState = 'pending' | 'draft' | 'registered';

/** An Acta in a list: the file's, or the tab's. */
export interface ActaRow {
  activity_id: string;
  target: ActaTarget;
  kind_id: string;
  meeting_date: string;
  salesperson_id: string;
  salesperson_name: string;
  state: ActaState;
  /** Its points, as they are headed. */
  points: { topic_id: string | null; title: string }[];
  agreements: { total: number; met: number };
  followUp: { status: 'none' | 'open' | 'overdue' | 'closed'; dueOn: string | null };
}
