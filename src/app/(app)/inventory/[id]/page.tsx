import { notFound } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getInventoryDetail, getInventoryLocations } from '@/server/inventory';
import { InventoryDetailView } from '@/components/inventory/inventory-detail';

// Never cached: two people may be counting the same inventory at once, and
// the 18:00 lock has to be evaluated against the real clock on every load.
export const dynamic = 'force-dynamic';

export default async function InventoryDetailPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  const canManage = viewer?.can('inventory.manage_instances') ?? false;

  const [detail, locations] = await Promise.all([
    getInventoryDetail(params.id),
    // Only needed for packaging counts, but fetching it unconditionally keeps
    // the component contract simple and the list is two rows.
    getInventoryLocations(),
  ]);

  if (!detail) notFound();

  // The assign dialog is the only consumer, so anyone who cannot manage
  // instances never pays for the query.
  const users = canManage ? await getUsers() : [];

  return (
    <InventoryDetailView
      detail={detail}
      locations={locations}
      users={users}
      canManage={canManage}
    />
  );
}
