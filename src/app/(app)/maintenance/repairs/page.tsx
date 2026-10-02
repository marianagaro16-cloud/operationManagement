import { redirect } from 'next/navigation';
import { getMyTeams, getViewer } from '@/server/data';
import { getRepairs } from '@/server/repairs';
import { getEquipmentChoices } from '@/server/equipment';
import { RepairList } from '@/components/maintenance/repairs';
import { canManageMaintenance, isExternal } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/** Repair requests: anyone reports; Maintenance sees them all. */
export default async function RepairsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (isExternal(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const tab = searchParams.tab === 'closed' ? 'closed' : 'open';
  const [repairs, equipment, myTeams] = await Promise.all([getRepairs(tab === 'open'), getEquipmentChoices(), getMyTeams(viewer.profile.id, viewer.profile.team)]);
  const isMaintenance = viewer.profile.team === 'maintenance' || canManageMaintenance(viewer.role, viewer.caps, myTeams);
  return <RepairList tab={tab} repairs={repairs} equipment={equipment} isMaintenance={isMaintenance} />;
}
