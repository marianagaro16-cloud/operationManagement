import { notFound, redirect } from 'next/navigation';
import { getMyTeams, getUsers, getViewer } from '@/server/data';
import { getRepair } from '@/server/repairs';
import { getEquipmentChoices } from '@/server/equipment';
import { RepairView } from '@/components/maintenance/repairs';
import { canManageMaintenance, isExternal } from '@/lib/authz';
import { displayName } from '@/lib/utils';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function RepairPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (isExternal(viewer.role, viewer.profile.team)) redirect('/dashboard');
  // Not found and not theirs look the same: RLS returned nothing.
  const [repair, equipment, myTeams, users] = await Promise.all([
    getRepair(params.id),
    getEquipmentChoices(),
    getMyTeams(viewer.profile.id, viewer.profile.team),
    getUsers(),
  ]);
  if (!repair) notFound();
  const isMaintenance = viewer.profile.team === 'maintenance' || canManageMaintenance(viewer.role, viewer.caps, myTeams);
  // Who a repair can be planned for: Maintenance's team, and the planner.
  const people = users
    .filter((u) => u.status === 'approved' && (u.team === 'maintenance' || u.id === viewer.profile.id))
    .map((u) => ({ id: u.id, name: displayName(u), team: u.team }));
  return <RepairView repair={repair} equipment={equipment} isMaintenance={isMaintenance} viewerId={viewer.profile.id} people={people} today={businessToday()} />;
}
