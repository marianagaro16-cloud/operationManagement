import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getPresence } from '@/server/presence';
import { OnlineUsers } from '@/components/admin/online-users';

export const dynamic = 'force-dynamic';

/**
 * Who is using the app right now. Admin-only, like the account list beside it:
 * where somebody is working is not every manager's business.
 */
export default async function AdminOnlinePage() {
  const viewer = await getViewer();
  if (!viewer?.can('users.manage')) redirect('/admin');

  const [users, presence] = await Promise.all([getUsers(), getPresence()]);

  return (
    <OnlineUsers
      users={users.filter((u) => u.status === 'approved')}
      initialPresence={presence}
    />
  );
}
