import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getEventCustomers, getEventLists, getEvents } from '@/server/events';
import { getSalesPeople } from '@/server/sales';
import { EventList } from '@/components/events/event-list';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Events: sales, Admin and Owners. Guarded here as well as by RLS. */
export default async function EventsPage() {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');

  const [events, { kinds }, people, customers] = await Promise.all([
    getEvents(),
    getEventLists(true),
    getSalesPeople(),
    getEventCustomers(),
  ]);
  return (
    <EventList
      events={events}
      choices={{ kinds, people, customers, viewerId: viewer.profile.id }}
      today={businessToday()}
    />
  );
}
