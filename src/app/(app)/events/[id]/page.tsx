import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getEvent, getEventCustomers, getEventLists, getStaffCandidates } from '@/server/events';
import { getSalesPeople } from '@/server/sales';
import { getDeliveryMethods, getProducts } from '@/server/orders';
import { EventView } from '@/components/events/event-view';
import { isMarketing, isSales } from '@/lib/authz';
import { EventsReadOnlyProvider } from '@/components/events/event-parts';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function EventPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  // Sales, Admin and Owners; Marketing reads (notes and photos only).
  const sales = !!viewer && isSales(viewer.role, viewer.profile.team);
  if (!viewer || !(sales || isMarketing(viewer.profile.team))) redirect('/dashboard');

  const [found, { kinds, costTypes }, people, customers, staff, catalog, methods] = await Promise.all([
    getEvent(params.id),
    getEventLists(true),
    getSalesPeople(),
    getEventCustomers(),
    getStaffCandidates(),
    getProducts(true),
    getDeliveryMethods(true),
  ]);
  if (!found) notFound();

  return (
    <EventsReadOnlyProvider readOnly={!sales}>
      <EventView
        {...found}
        choices={{ kinds, people, customers, viewerId: viewer.profile.id }}
        staff={staff}
        costTypes={costTypes}
        catalog={catalog}
        methods={methods}
        today={businessToday()}
      />
    </EventsReadOnlyProvider>
  );
}
