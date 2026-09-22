import { getUsers, getViewer } from '@/server/data';
import { teamScope } from '@/lib/authz';
import { getEditGrants, getInventories } from '@/server/inventory';
import { addDays, businessToday } from '@/lib/datetime';
import { InventoryPermissionManager } from '@/components/admin/inventory-permissions';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryPermissionsPage() {
  const today = businessToday();
  const viewer = await getViewer();
  // A grant is given to someone in the viewer's scope; the database refuses others.
  const scope = viewer ? teamScope(viewer.role, viewer.profile.team) : null;

  const [grants, allUsers, instances] = await Promise.all([
    getEditGrants(),
    getUsers(),
    // A grant is only ever needed for a recent or imminent inventory, and a
    // permission cannot span more than one day anyway — so the picker offers a
    // short window rather than the whole history.
    getInventories({ from: addDays(today, -14), to: addDays(today, 14), limit: 100 }),
  ]);

  const users = allUsers.filter((u) => scope === null || u.team === scope);

  return (
    <InventoryPermissionManager
      grants={grants}
      users={users}
      instances={instances.rows.map((i) => ({
        id: i.id,
        name_snapshot: i.name_snapshot,
        inventory_date: i.inventory_date,
      }))}
    />
  );
}
