import type { AgreementResult, CompanyTopic } from '@/domain/hr/note-structure';

/** Internal meetings. */

export type MeetingPlace = 'office' | 'online' | 'other';
export type MeetingResponse = 'pending' | 'yes' | 'no';

export interface MeetingInvitee {
  profile_id: string;
  name: string;
  response: MeetingResponse;
  note: string | null;
}

export interface Meeting {
  id: string;
  series_id: string | null;
  detached: boolean;
  organizer_id: string;
  organizer_name: string;
  title: string;
  agenda: string | null;
  place: MeetingPlace | null;
  place_detail: string | null;
  meeting_date: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'cancelled';
  minutes: string | null;
  minutes_at: string | null;
  /** One for the workers' files: chased until its record is registered. */
  hr_record: boolean;
  invitees: MeetingInvitee[];
}

export interface MeetingSeries {
  id: string;
  interval_weeks: 1 | 2;
  /** Monthly on the nth weekday (1–4, or -1 for the last); null repeats by weeks. */
  monthly_nth: number | null;
  weekday: number;
  starts_on: string;
  until: string | null;
  ended_at: string | null;
}

/* ------------------- a meeting's record for the workers' files ------------------- */

export interface MeetingAttendee {
  id: string;
  profile_id: string | null;
  worker_id: string | null;
  name: string;
}

/** One thing agreed at a meeting: what, who — one attendee or all of them — and by when. */
export interface MeetingAgreement {
  id: string;
  body: string;
  responsible_all: boolean;
  responsible_profile_id: string | null;
  responsible_worker_id: string | null;
  responsible_name: string | null;
  due_on: string | null;
  /** What each follow-up said of it, oldest first. */
  results: { entry_id: string; result: AgreementResult; comment: string | null }[];
}

/** An agenda point as it was dealt with. */
export interface MeetingRecordPoint {
  id: string;
  title: string;
  topic: CompanyTopic | null;
  situation: string | null;
  discussed: string | null;
  no_agreements_reason: string | null;
  agreements: MeetingAgreement[];
}

/** Added after the record was registered: an addendum, or what came of the follow-up. */
export interface MeetingRecordEntry {
  id: string;
  kind: 'addendum' | 'followup';
  entry_date: string;
  body: string;
  closes: boolean;
  next_on: string | null;
  created_at: string;
  author_name: string | null;
}

/** What was said at a meeting, with whom — a draft until it is registered, permanent after. */
export interface MeetingRecord {
  meeting_id: string;
  title: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  place: MeetingPlace | null;
  place_detail: string | null;
  organizer_id: string | null;
  organizer_name: string;
  follow_up_on: string | null;
  registered_at: string | null;
  registered_by_name: string | null;
  attendees: MeetingAttendee[];
  points: MeetingRecordPoint[];
  /** Oldest first. */
  entries: MeetingRecordEntry[];
}
