import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getPersonalTasks } from '@/server/reminders';
import { PersonalTaskList } from '@/components/reminders/personal-tasks';
import { canUseReminders } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function PersonalTasksPage() {
  const viewer = await getViewer();
  if (!viewer || !canUseReminders(viewer)) redirect('/dashboard');

  const { open, closed } = await getPersonalTasks();
  return <PersonalTaskList open={open} closed={closed} nowIso={new Date().toISOString()} />;
}
