import { notFound, redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getUsers, getViewer } from '@/server/data';
import { getSummary } from '@/server/sales-summary';
import { getMeetingsFor } from '@/server/meetings';
import { SummaryPage } from '@/components/summaries/summary-page';
import { isSales } from '@/lib/authz';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { displayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** A saved sales summary — for sales, and whoever it was shared with (RLS). */
export default async function SummaryRoute({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const summary = await getSummary(params.id);
  if (!summary) notFound();

  const canShare = isSales(viewer.role, viewer.profile.team);
  const today = businessToday();
  const [users, meetings] = canShare
    ? await Promise.all([
        getUsers(),
        getMeetingsFor(viewer.profile.id, today, DateTime.fromISO(today, { zone: BUSINESS_TZ }).plus({ weeks: 6 }).toISODate()!),
      ])
    : [[], []];

  return (
    <SummaryPage
      summary={summary}
      canShare={canShare}
      people={users.filter((u) => u.status === 'approved' && u.id !== viewer.profile.id).map((u) => ({ id: u.id, name: displayName(u) }))}
      meetings={meetings.map((m) => ({ id: m.id, label: `${m.meeting_date.slice(8, 10)}.${m.meeting_date.slice(5, 7)}. ${m.start_time.slice(0, 5)} · ${m.title}` }))}
    />
  );
}
