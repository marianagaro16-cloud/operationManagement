import { Suspense } from 'react';
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

  return (
    // useSearchParams (the ?edit= deep link) requires a suspense boundary.
    <Suspense>
      <TaskManager
        tasks={tasks}
        categories={categories}
        people={users
          .filter((u) => u.status === 'approved')
          .map((u) => ({ id: u.id, name: displayName(u), team: u.team }))}
        reminderViewerId={viewer && canUseReminders(viewer) ? viewer.profile.id : null}
      />
    </Suspense>
  );
}
