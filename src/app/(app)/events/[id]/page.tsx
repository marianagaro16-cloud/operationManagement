import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getEvent, getEventCustomers, getEventLists, getEventTaskPeople, getPastMaterials, getStaffCandidates } from '@/server/events';
import { getSalesPeople } from '@/server/sales';
import { getDeliveryMethods, getProducts } from '@/server/orders';
import { EventView } from '@/components/events/event-view';
import { EventPosts } from '@/components/marketing/marketing-parts';
import { getEventPosts } from '@/server/marketing';
import { isAdminRole, isMarketing, isSales } from '@/lib/authz';
import { EventsReadOnlyProvider } from '@/components/events/event-parts';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function EventPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  // Sales, Admin and Owners; Marketing too, without contacts, budget and products, ticking only its own tasks.
  const sales = !!viewer && isSales(viewer.role, viewer.profile.team);
  if (!viewer || !(sales || isMarketing(viewer.profile.team))) redirect('/dashboard');

  const [found, { kinds, costTypes, kindMaterials }, people, customers, staff, catalog, methods, pastMaterials, taskPeople] = await Promise.all([
    getEvent(params.id),
    getEventLists(true),
    getSalesPeople(),
    getEventCustomers(),
    getStaffCandidates(),
    getProducts(true),
    getDeliveryMethods(true),
    getPastMaterials(params.id),
    getEventTaskPeople(),
  ]);
  // The content plan's posts about this event; RLS returns none to whoever cannot read the plan.
  const posts = found ? await getEventPosts(params.id) : [];
  if (!found) notFound();

  return (
    <EventsReadOnlyProvider readOnly={false} limited={!sales}>
      <EventView
        {...found}
        standardMaterials={kindMaterials.filter((m) => m.kind_id === found.event.kind_id).map((m) => m.name)}
        pastMaterials={pastMaterials}
        taskPeople={taskPeople}
        canEditStandard={isAdminRole(viewer.role)}
        choices={{ kinds, people, customers, viewerId: viewer.profile.id }}
        staff={staff}
        costTypes={costTypes}
        catalog={catalog}
        methods={methods}
        today={businessToday()}
      />
      <EventPosts posts={posts} />
    </EventsReadOnlyProvider>
  );
}
