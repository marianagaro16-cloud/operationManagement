import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getActivityKinds, getCustomerTypes, getPlannedFor, getProspectLists, getProspect, getSalesPeople } from '@/server/sales';
import { getActaTopics, getTargetActas } from '@/server/sales-actas';
import { ProspectView } from '@/components/sales/prospect-view';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function ProspectPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');

  const today = businessToday();
  const [found, people, customerTypes, lists, kinds, planned, actas, actaTopics] = await Promise.all([
    getProspect(params.id),
    getSalesPeople(),
    getCustomerTypes(),
    getProspectLists(true),
    getActivityKinds(true),
    getPlannedFor({ prospectId: params.id }),
    getTargetActas({ prospectId: params.id }, today),
    getActaTopics(true),
  ]);
  if (!found) notFound();

  return (
    <ProspectView
      prospect={found.prospect}
      notes={found.notes}
      planned={planned}
      choices={{ people, customerTypes, ...lists, kinds, viewerId: viewer.profile.id }}
      customerTypeName={customerTypes.find((c) => c.id === found.prospect.customer_type_id)?.name ?? null}
      today={today}
      actas={actas}
      actaTopics={actaTopics}
    />
  );
}
