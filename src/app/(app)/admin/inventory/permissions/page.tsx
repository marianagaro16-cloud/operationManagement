import { getUsers } from '@/server/data';
import { getEditGrants, getInventories } from '@/server/inventory';
import { addDays, businessToday } from '@/lib/datetime';
import { InventoryPermissionManager } from '@/components/admin/inventory-permissions';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryPermissionsPage() {
  const today = businessToday();

  const [grants, users, instances] = await Promise.all([
    getEditGrants(),
    getUsers(),
    // A grant is only ever needed for a recent or imminent inventory, and a
    // permission cannot span more than one day anyway — so the picker offers a
    // short window rather than the whole history.
    getInventories({ from: addDays(today, -14), to: addDays(today, 14), limit: 100 }),
  ]);

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
