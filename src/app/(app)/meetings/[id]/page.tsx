import { notFound, redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getMeeting } from '@/server/meetings';
import { getMeetingRecord } from '@/server/meeting-records';
import { getWorkers } from '@/server/hr';
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

  const canFile = viewer.can('hr.manage');
  const [record, workers, absences, hours, users, summaries] = await Promise.all([
    getMeetingRecord(meeting.id),
    // The files the viewer may open: whom attendees are picked from.
    canFile ? getWorkers() : Promise.resolve([]),
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

  // Who can have been there: everyone with a file the viewer may see, then every
  // account without one. An account and its file are one person.
  const filed = new Set(workers.map((w) => w.profile_id).filter(Boolean));
  const attendable = [
    ...workers.filter((w) => w.is_active).map((w) => ({ profile_id: w.profile_id, worker_id: w.id, name: w.name })),
    ...users.filter((u) => u.status === 'approved' && !filed.has(u.id)).map((u) => ({ profile_id: u.id, worker_id: null, name: displayName(u) })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <MeetingView
      record={record}
      attendable={attendable}
      canFile={canFile}
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
