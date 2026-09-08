import { redirect } from 'next/navigation';
import { getUnconfiguredTasks, getUsers, getViewer } from '@/server/data';
import { getScheduleHealth } from '@/server/scheduling';
import { ConfigHealth } from '@/components/admin/config-health';
import { AdminHub } from '@/components/admin/admin-hub';

export const dynamic = 'force-dynamic';

/**
 * The management area's front door.
 *
 * Was an Overview screen sitting as the first of eighteen tabs. It is now the
 * page itself: four section cards, with the configuration health above them
 * and pending approvals shown on the System card. A warning on a tab nobody
 * opens is a warning nobody sees.
 */
export default async function AdminHubPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/dashboard');

  // Only DAILY definitions can be misconfigured now, because they are the only
  // ones a schedule still drives. Inventory templates dropped out of this
  // panel entirely for the same reason: there is no schedule left to resolve.
  const [unconfigured, health, users] = await Promise.all([
    getUnconfiguredTasks(),
    getScheduleHealth(),
    // Only somebody who can act on an approval is told there is one waiting.
    viewer.can('users.manage') ? getUsers() : Promise.resolve([]),
  ]);

  return (
    <AdminHub
      role={viewer.role}
      caps={[...viewer.caps]}
      pendingUsers={users.filter((u) => u.status === 'pending').length}
      health={<ConfigHealth unconfigured={unconfigured} stalled={health.stalled} />}
    />
  );
}
