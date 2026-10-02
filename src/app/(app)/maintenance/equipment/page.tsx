import { redirect } from 'next/navigation';
import { getMyTeams, getViewer } from '@/server/data';
import { getEquipmentList } from '@/server/equipment';
import { EquipmentList } from '@/components/maintenance/equipment';
import { canManageMaintenance, isExternal } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** The equipment list: Maintenance keeps it; the company reads it. */
export default async function EquipmentPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (isExternal(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const [list, myTeams] = await Promise.all([getEquipmentList(), getMyTeams(viewer.profile.id, viewer.profile.team)]);
  return <EquipmentList list={list} canManage={canManageMaintenance(viewer.role, viewer.caps, myTeams)} today={businessToday()} />;
}
