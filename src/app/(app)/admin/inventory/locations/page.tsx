import { getInventoryLocations } from '@/server/inventory';
import { InventoryLocationManager } from '@/components/admin/inventory-locations';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryLocationsPage() {
  // Inactive locations are shown here so they can be reactivated; the counting
  // screens only ever offer the active ones.
  const locations = await getInventoryLocations(true);
  return <InventoryLocationManager locations={locations} />;
}
