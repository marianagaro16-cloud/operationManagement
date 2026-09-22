import { notFound, redirect } from 'next/navigation';
import { displayName } from '@/lib/utils';
import { getUsers, getViewer } from '@/server/data';
import { getIncident } from '@/server/incidents';
import { getCustomers, getDeliveryMethods, getProducts } from '@/server/orders';
import { IncidentDetail } from '@/components/incidents/incident-detail';
import { canUseReminders, ordersReadOnly, teamScope } from '@/lib/authz';

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

  // A production manager reads every incident but manages only their team's;
  // the update policies say the same in the database.
  const scope = teamScope(viewer.role, viewer.profile.team);
  const canManage = viewer.can('incidents.manage') && (scope === null || incident.team === scope);

  /*
   * Only for somebody who can act. A read-only viewer is handed neither the
   * staff list (for assigning a corrective action) nor the master data that
   * raising a replacement ORDER needs — the order editor this page opens is
   * the ordinary one, and it wants the ordinary pickers.
   */
  const [users, customers, products, deliveryMethods] = canManage
    ? await Promise.all([
        // Corrective actions go to people in the viewer's scope only.
        getUsers().then((all) =>
          all.filter((u) => u.status === 'approved' && (scope === null || u.team === scope)),
        ),
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
      // Holding the permission yet unable to act means the team, not a
      // missing permission — and the notice should say which.
      otherTeam={viewer.can('incidents.manage') && !canManage}
      // A replacement is an ORDER, and orders are read-only for some roles.
      canReplace={canManage && !ordersReadOnly(viewer.role)}
      // Moving an incident between teams is for someone who sees both.
      canChangeTeam={canManage && scope === null}
      canClose={viewer.can('incidents.close')}
      reminderViewerId={canUseReminders(viewer) ? viewer.profile.id : null}
      currentUserName={displayName(viewer.profile)}
    />
  );
}
