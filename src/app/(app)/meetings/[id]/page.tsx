import { notFound, redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getMeeting } from '@/server/meetings';
import { getMeetingSummaries } from '@/server/sales-summary';
import { getAbsenceCalendar } from '@/server/absences';
import { getWorkingHours } from '@/server/coverage';
import { coverageConflicts } from '@/domain/absences/coverage';
import { MeetingView } from '@/components/meetings/meeting-view';
import { businessToday } from '@/lib/datetime';
import { displayName } from '@/lib/utils';
import { isAdminRole } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/** One meeting — for its organiser, its invitees and Admin (RLS). */
export default async function MeetingPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const found = await getMeeting(params.id);
  if (!found) notFound();
  const { meeting, series } = found;

  const [absences, hours, users, summaries] = await Promise.all([
    getAbsenceCalendar(meeting.meeting_date, meeting.meeting_date),
    getWorkingHours(),
    getUsers(),
    getMeetingSummaries(meeting.id),
  ]);
  // Away then: an approved absence covers the meeting's time.
  const slot = { date: meeting.meeting_date, start: meeting.start_time.slice(0, 5), end: meeting.end_time.slice(0, 5) };
  const away = meeting.invitees
    .filter((i) => coverageConflicts(slot, absences.filter((a) => a.profile_id === i.profile_id), [], hours).length > 0)
    .map((i) => i.profile_id);
  const nowHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

  return (
    <MeetingView
      meeting={meeting}
      series={series}
      viewerId={viewer.profile.id}
      canChange={meeting.organizer_id === viewer.profile.id || isAdminRole(viewer.role)}
      away={away}
      people={users.filter((u) => u.status === 'approved').map((u) => ({ id: u.id, name: displayName(u) }))}
      today={businessToday()}
      nowHm={nowHm}
      summaries={summaries}
    />
  );
}
