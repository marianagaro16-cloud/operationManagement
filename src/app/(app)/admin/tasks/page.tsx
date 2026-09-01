import { Suspense } from 'react';
import { getCategories, getTasksForAdmin } from '@/server/data';
import { TaskManager } from '@/components/admin/task-manager';

export const dynamic = 'force-dynamic';

export default async function AdminTasksPage() {
  const [tasks, categories] = await Promise.all([getTasksForAdmin(), getCategories()]);

  return (
    // useSearchParams (the ?edit= deep link) requires a suspense boundary.
    <Suspense>
      <TaskManager tasks={tasks} categories={categories} />
    </Suspense>
  );
}
