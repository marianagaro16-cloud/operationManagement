import { getProfile, getUsers } from '@/server/data';
import { UserManager } from '@/components/admin/user-manager';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const [users, me] = await Promise.all([getUsers(), getProfile()]);
  return <UserManager users={users} currentUserId={me?.id ?? ''} />;
}
