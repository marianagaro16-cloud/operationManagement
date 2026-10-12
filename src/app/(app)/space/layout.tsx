import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getNotes } from '@/server/notes';
import { getPersonalTasks } from '@/server/reminders';
import { getUnreadInboxCount } from '@/server/inbox';
import { SpaceShell } from '@/components/space/space-shell';

export const dynamic = 'force-dynamic';

/**
 * "Mi espacio": one's own tasks, notes and notifications. Everything listed
 * here is the viewer's own — each table's rules return nobody else's.
 */
export default async function SpaceLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const [notes, tasks, unread] = await Promise.all([getNotes(), getPersonalTasks(), getUnreadInboxCount()]);
  return (
    <SpaceShell notes={notes} tasks={tasks.open.map((task) => ({ id: task.id, title: task.title }))} unread={unread}>
      {children}
    </SpaceShell>
  );
}
