import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getPersonalTasks } from '@/server/reminders';
import { PersonalTaskList } from '@/components/reminders/personal-tasks';

export const dynamic = 'force-dynamic';

export default async function PersonalTasksPage() {
  const viewer = await getViewer();
  if (!viewer?.can('reminders.use')) redirect('/dashboard');

  const { open, closed } = await getPersonalTasks();
  return <PersonalTaskList open={open} closed={closed} nowIso={new Date().toISOString()} />;
}
