import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Meeting, MeetingSeries } from '@/types/meetings';

/*
 * Meetings reads. RLS gives a meeting to its organiser, its invitees and
 * Admin; "mine" narrows Admin's view to what they organise or are invited to.
 */

const COLUMNS = `
  id, series_id, detached, organizer_id, title, agenda, place, place_detail, meeting_date, start_time, end_time,
  status, minutes, minutes_at,
  organizer:profiles!meetings_organizer_id_fkey ( name, email ),
  invitees:meeting_invitees ( profile_id, response, note, person:profiles ( name, email ) )
`;

type Person = { name: string | null; email: string } | null;
const nameOf = (p: Person) => (p ? p.name || p.email : '—');
type Raw = Omit<Meeting, 'organizer_name' | 'invitees'> & {
  organizer: Person;
  invitees: { profile_id: string; response: Meeting['invitees'][number]['response']; note: string | null; person: Person }[] | null;
};

function toMeeting({ organizer, invitees, ...m }: Raw): Meeting {
  return {
    ...m,
    organizer_name: nameOf(organizer),
    invitees: (invitees ?? [])
      .map(({ person, ...i }) => ({ ...i, name: nameOf(person) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function canOrganizeMeetings(): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.rpc('can_organize_meetings');
  return data === true;
}

/** Someone's meetings — organised or invited to — between two days, in order. */
export async function getMeetingsFor(profileId: string, from: string, to: string, withCancelled = false): Promise<Meeting[]> {
  const supabase = createClient();
  let q = supabase.from('meetings').select(COLUMNS).gte('meeting_date', from).lte('meeting_date', to);
  if (!withCancelled) q = q.eq('status', 'scheduled');
  const { data, error } = await q.order('meeting_date').order('start_time');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Raw[])
    .map(toMeeting)
    .filter((m) => m.organizer_id === profileId || m.invitees.some((i) => i.profile_id === profileId));
}

/** The viewer's past meetings, latest first. */
export async function getPastMeetings(profileId: string, before: string, limit = 60): Promise<Meeting[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('meetings')
    .select(COLUMNS)
    .lt('meeting_date', before)
    .order('meeting_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(limit * 3);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Raw[])
    .map(toMeeting)
    .filter((m) => m.organizer_id === profileId || m.invitees.some((i) => i.profile_id === profileId))
    .slice(0, limit);
}

export async function getMeeting(id: string): Promise<{ meeting: Meeting; series: MeetingSeries | null } | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('meetings').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const meeting = toMeeting(data as unknown as Raw);
  let series: MeetingSeries | null = null;
  if (meeting.series_id) {
    const { data: s } = await supabase
      .from('meeting_series')
      .select('id, interval_weeks, monthly_nth, weekday, starts_on, until, ended_at')
      .eq('id', meeting.series_id)
      .maybeSingle();
    series = (s as MeetingSeries | null) ?? null;
  }
  return { meeting, series };
}

/** Invitations the viewer has not answered, for meetings still ahead. */
export async function countUnansweredInvites(profileId: string, today: string): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from('meeting_invitees')
    .select('meeting_id, meeting:meetings!inner ( meeting_date, status )', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('response', 'pending')
    .eq('meeting.status', 'scheduled')
    .gte('meeting.meeting_date', today);
  return count ?? 0;
}
