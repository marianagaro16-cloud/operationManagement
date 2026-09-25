import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getCategories, getTasksForAdmin, getUsers, getViewer } from '@/server/data';
import { displayName } from '@/lib/utils';
import { TaskManager } from '@/components/admin/task-manager';
import { canUseReminders } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function AdminTasksPage() {
  const [tasks, categories, viewer, users] = await Promise.all([
    getTasksForAdmin(),
    getCategories(),
    getViewer(),
    getUsers(),
  ]);

  // Every team's activities, or — for a team's manager — their own team's only.
  if (!viewer) redirect('/dashboard');
  const ownTeam = viewer.can('tasks.manage_definitions')
    ? null
    : viewer.can('tasks.manage_own_team')
      ? viewer.profile.team
      : redirect('/admin');

  return (
    // useSearchParams (the ?edit= deep link) requires a suspense boundary.
    <Suspense>
      <TaskManager
        tasks={ownTeam ? tasks.filter((t) => t.team === ownTeam) : tasks}
        ownTeam={ownTeam}
        categories={categories}
        people={users
          .filter((u) => u.status === 'approved' && (!ownTeam || u.team === ownTeam))
          .map((u) => ({ id: u.id, name: displayName(u), team: u.team }))}
        reminderViewerId={canUseReminders(viewer) ? viewer.profile.id : null}
      />
    </Suspense>
  );
}
