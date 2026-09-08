import { notFound, redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getIncident } from '@/server/incidents';
import { getCustomers, getDeliveryMethods, getProducts } from '@/server/orders';
import { IncidentDetail } from '@/components/incidents/incident-detail';

export const dynamic = 'force-dynamic';

/**
 * One incident.
 *
 * RLS decides whether the row is visible at all, so a user who may not see it
 * gets a 404 rather than a permission message — which is correct: telling
 * somebody an incident exists but is none of their business is itself a
 * disclosure.
 */
export default async function IncidentPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') redirect('/dashboard');

  const incident = await getIncident(params.id);
  if (!incident) notFound();

  const canManage = viewer.can('incidents.manage');

  /*
   * Only for somebody who can act. A read-only viewer is handed neither the
   * staff list (for assigning a corrective action) nor the master data that
   * raising a replacement ORDER needs — the order editor this page opens is
   * the ordinary one, and it wants the ordinary pickers.
   */
  const [users, customers, products, deliveryMethods] = canManage
    ? await Promise.all([
        getUsers().then((all) => all.filter((u) => u.status === 'approved')),
        getCustomers(),
        getProducts(),
        getDeliveryMethods(),
      ])
    : [[], [], [], []];

  return (
    <IncidentDetail
      incident={incident}
      users={users}
      customers={customers}
      products={products}
      deliveryMethods={deliveryMethods}
      canManage={canManage}
      canClose={viewer.can('incidents.close')}
    />
  );
}
