import { getPersonalTasks, getPersonalTopics } from '@/server/reminders';
import { SpaceTasks } from '@/components/space/task-list';

export const dynamic = 'force-dynamic';

/** The viewer's personal tasks. */
export default async function SpaceTasksPage() {
  const [{ open, closed }, topics] = await Promise.all([getPersonalTasks(), getPersonalTopics()]);
  return <SpaceTasks open={open} closed={closed} topics={topics} nowIso={new Date().toISOString()} />;
}
