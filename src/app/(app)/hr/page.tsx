import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getWorkers } from '@/server/hr';
import { WorkerList } from '@/components/hr/worker-list';
import { displayName } from '@/lib/utils';
import { TEAMS, incidentScope } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/**
 * Human resources: every worker with a file. Guarded here as well as by RLS,
 * which is what actually confines a Production manager to Production.
 */
export default async function HrPage() {
  const viewer = await getViewer();
  if (!viewer?.can('hr.manage')) redirect('/dashboard');

  const [workers, users] = await Promise.all([getWorkers(), getUsers()]);
  // Same scope as incidents: a Production manager files Production's people.
  const scope = incidentScope(viewer.role, viewer.profile.team);

  return (
    <WorkerList
      workers={workers}
      accounts={users
        .filter((u) => u.status === 'approved')
        .map((u) => ({ id: u.id, name: displayName(u), team: u.team }))}
      teams={scope ? [scope] : [...TEAMS]}
    />
  );
}
