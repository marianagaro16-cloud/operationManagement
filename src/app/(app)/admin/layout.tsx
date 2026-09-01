import { redirect } from 'next/navigation';
import { getProfile } from '@/server/data';
import { AdminNav } from '@/components/admin/admin-nav';

/**
 * Admin gate. Cosmetic only — every admin capability is independently
 * enforced by RLS (`is_admin()`), so a user who forges their way to these
 * routes sees empty lists and gets rejected writes.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile || profile.role !== 'admin' || profile.status !== 'approved') {
    redirect('/dashboard');
  }

  return (
    <div>
      <AdminNav />
      {children}
    </div>
  );
}
