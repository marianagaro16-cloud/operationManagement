import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getPermissionCatalog, getRoleMatrix } from '@/server/permissions';
import { RolePermissions } from '@/components/admin/role-permissions';

export const dynamic = 'force-dynamic';

/**
 * Admin-only, permanently. Deciding what a Manager may do is system control,
 * not operational configuration, so it is never delegated to a Manager.
 */
export default async function AdminPermissionsPage() {
  const viewer = await getViewer();
  if (!viewer?.can('permissions.configure')) redirect('/admin');

  const [catalog, matrix] = await Promise.all([getPermissionCatalog(), getRoleMatrix()]);

  return <RolePermissions catalog={catalog} matrix={matrix} />;
}
