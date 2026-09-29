import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getEvent, getEventCustomers, getEventLists, getStaffCandidates } from '@/server/events';
import { getSalesPeople } from '@/server/sales';
import { EventView } from '@/components/events/event-view';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function EventPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');

  const [found, { kinds, costTypes }, people, customers, staff] = await Promise.all([
    getEvent(params.id),
    getEventLists(true),
    getSalesPeople(),
    getEventCustomers(),
    getStaffCandidates(),
  ]);
  if (!found) notFound();

  return (
    <EventView
      {...found}
      choices={{ kinds, people, customers, viewerId: viewer.profile.id }}
      staff={staff}
      costTypes={costTypes}
      today={businessToday()}
    />
  );
}
