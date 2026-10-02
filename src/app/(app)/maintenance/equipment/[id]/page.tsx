import { notFound, redirect } from 'next/navigation';
import { getMyTeams, getViewer } from '@/server/data';
import { getEquipment } from '@/server/equipment';
import { getRepairs } from '@/server/repairs';
import { EquipmentView } from '@/components/maintenance/equipment';
import { canManageMaintenance, isExternal } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function EquipmentDetailPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (isExternal(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const [found, myTeams, repairs] = await Promise.all([
    getEquipment(params.id),
    getMyTeams(viewer.profile.id, viewer.profile.team),
    getRepairs(false, params.id),
  ]);
  if (!found) notFound();
  return <EquipmentView {...found} repairs={repairs} canManage={canManageMaintenance(viewer.role, viewer.caps, myTeams)} today={businessToday()} />;
}
