import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getIncidentTypes } from '@/server/incidents';
import {
  getReception,
  getReceptionHistory,
  getReceptionProducts,
  getSuppliers,
  getTransporters,
  isReceptionAssignee,
} from '@/server/goods-reception';
import { canEditReception } from '@/domain/goods-reception/workflow';
import { ReceptionDetailView } from '@/components/goods-reception/reception-detail';

export const dynamic = 'force-dynamic';

/**
 * One delivery.
 *
 * Readable by every approved user (§11); what the viewer may DO is resolved
 * here and passed down, so the component never re-derives a permission and
 * the two can never disagree. RLS answers the same questions again on every
 * write, which is what actually enforces them.
 */
export default async function ReceptionDetailPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') redirect('/dashboard');

  const reception = await getReception(params.id);
  if (!reception) notFound();

  const canManageAll = viewer.can('goods_reception.manage_all');
  const assignee = canManageAll ? false : await isReceptionAssignee(viewer.profile.id);

  const canEdit = canEditReception({
    status: reception.status,
    isAssignee: assignee,
    canManageAll,
  });

  const [suppliers, transporters, products, incidentTypes, history] = await Promise.all([
    getSuppliers(),
    getTransporters(),
    // Only offered when the viewer can actually add an exception — loading
    // the whole product master for a read-only reader is wasted bytes on a
    // phone.
    canEdit ? getReceptionProducts() : Promise.resolve([]),
    canEdit || viewer.can('incidents.manage') ? getIncidentTypes() : Promise.resolve([]),
    // RLS returns nothing without audit.view_operational, so this is empty
    // for most viewers and the section simply does not render.
    getReceptionHistory(params.id),
  ]);

  return (
    <ReceptionDetailView
      reception={reception}
      suppliers={suppliers}
      transporters={transporters}
      products={products}
      incidentTypes={incidentTypes}
      history={history}
      canEdit={canEdit}
      canManageAll={canManageAll}
      // §24: an assignee may raise one, and so may anyone who already manages
      // incidents. Both are re-checked by the widened insert policy.
      canReportIncident={
        (assignee || canManageAll || viewer.can('incidents.manage')) &&
        incidentTypes.length > 0
      }
      // Reception incidents are visible to every approved user by the widened
      // can_view_incident(), so this is true for anyone who got this far. It
      // stays a prop rather than a constant because the rule lives in SQL and
      // could be narrowed there without this page noticing.
      canSeeIncidents
    />
  );
}
