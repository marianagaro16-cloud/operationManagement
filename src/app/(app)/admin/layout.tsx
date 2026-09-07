import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { AdminNav } from '@/components/admin/admin-nav';

/**
 * The management-area gate.
 *
 * Was admin-only; a Manager and a Power User now belong here too, because the
 * screens they need — orders, customers, products, inventory templates — have
 * always lived under /admin. Duplicating them outside it would mean two copies
 * of every screen.
 *
 * So the gate opens at power_user and the NAV decides which tabs are offered,
 * while the genuinely admin-only pages (users, settings, the permission
 * matrix) guard themselves. Cosmetic either way: every capability is
 * independently enforced by `has_permission()` in RLS, so a user who forges
 * their way to one of these routes sees empty lists and rejected writes.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved' || !viewer.atLeast('power_user')) {
    redirect('/dashboard');
  }

  return (
    <div>
      <AdminNav caps={[...viewer.caps]} role={viewer.role} />
      {children}
    </div>
  );
}
