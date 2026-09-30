import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getViewer } from '@/server/data';
import { agendaPeople, getAgenda } from '@/server/agenda';
import { getActivityKinds } from '@/server/sales';
import { AgendaView } from '@/components/agenda/agenda-view';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { isSales } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/**
 * The agenda: a person's week from every part of the app. One's own; Admin,
 * Owners and Managers anyone's; the Production manager their team's.
 */
export default async function AgendaPage({ searchParams }: { searchParams: { date?: string; person?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const today = businessToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : today;

  const people = await agendaPeople({ id: viewer.profile.id, role: viewer.role, team: viewer.profile.team });
  const personId = searchParams.person && people.some((p) => p.id === searchParams.person) ? searchParams.person : viewer.profile.id;
  const own = personId === viewer.profile.id;

  const monday = DateTime.fromISO(date, { zone: BUSINESS_TZ }).startOf('week');
  const [items, kinds] = await Promise.all([
    getAgenda(personId, monday.toISODate()!, monday.plus({ days: 6 }).toISODate()!, own, today),
    isSales(viewer.role, viewer.profile.team) ? getActivityKinds(true) : [],
  ]);

  return (
    <AgendaView
      items={items}
      date={date}
      today={today}
      personId={personId}
      viewerId={viewer.profile.id}
      people={people}
      kinds={kinds}
    />
  );
}
