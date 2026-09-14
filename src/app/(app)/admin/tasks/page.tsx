import { Suspense } from 'react';
import { getCategories, getTasksForAdmin, getViewer } from '@/server/data';
import { TaskManager } from '@/components/admin/task-manager';
import { canUseReminders } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function AdminTasksPage() {
  const [tasks, categories, viewer] = await Promise.all([
    getTasksForAdmin(),
    getCategories(),
    getViewer(),
  ]);

  return (
    // useSearchParams (the ?edit= deep link) requires a suspense boundary.
    <Suspense>
      <TaskManager
        tasks={tasks}
        categories={categories}
        reminderViewerId={viewer && canUseReminders(viewer) ? viewer.profile.id : null}
      />
    </Suspense>
  );
}
