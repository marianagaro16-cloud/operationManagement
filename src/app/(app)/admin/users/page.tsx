import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { UserManager } from '@/components/admin/user-manager';

export const dynamic = 'force-dynamic';

/**
 * Admin-only, guarded here rather than by the layout: the layout now admits
 * Manager and Power User, and creating or approving a user is never theirs.
 */
export default async function AdminUsersPage() {
  const viewer = await getViewer();
  if (!viewer?.can('users.manage')) redirect('/admin');

  const users = await getUsers();
  return <UserManager users={users} currentUserId={viewer.profile.id} />;
}
