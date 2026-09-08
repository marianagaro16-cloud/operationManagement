import { notFound, redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getIncident } from '@/server/incidents';
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

  // Only for the corrective-action assignee picker, and only for somebody who
  // can raise one. A read-only viewer is not handed the staff list.
  const users = viewer.can('incidents.manage')
    ? (await getUsers()).filter((u) => u.status === 'approved')
    : [];

  return (
    <IncidentDetail
      incident={incident}
      users={users}
      canManage={viewer.can('incidents.manage')}
      canClose={viewer.can('incidents.close')}
    />
  );
}
