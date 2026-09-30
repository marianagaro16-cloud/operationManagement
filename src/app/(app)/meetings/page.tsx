import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getUsers, getViewer } from '@/server/data';
import { canOrganizeMeetings, getMeetingsFor, getPastMeetings } from '@/server/meetings';
import { MeetingsView } from '@/components/meetings/meetings-view';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { displayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** Internal meetings, for everyone with an account: what they organise or are invited to. */
export default async function MeetingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const today = businessToday();
  const tab = searchParams.tab === 'past' ? 'past' : 'upcoming';
  const until = DateTime.fromISO(today, { zone: BUSINESS_TZ }).plus({ weeks: 16 }).toISODate()!;

  const [meetings, organize, users] = await Promise.all([
    tab === 'past' ? getPastMeetings(viewer.profile.id, today) : getMeetingsFor(viewer.profile.id, today, until, true),
    canOrganizeMeetings(),
    getUsers(),
  ]);
  return (
    <MeetingsView
      tab={tab}
      meetings={meetings}
      viewerId={viewer.profile.id}
      canOrganize={organize}
      people={users.filter((u) => u.status === 'approved').map((u) => ({ id: u.id, name: displayName(u) }))}
      today={today}
    />
  );
}
