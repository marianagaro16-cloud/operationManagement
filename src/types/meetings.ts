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
  invitees: MeetingInvitee[];
}

export interface MeetingSeries {
  id: string;
  interval_weeks: 1 | 2;
  weekday: number;
  starts_on: string;
  until: string | null;
  ended_at: string | null;
}
