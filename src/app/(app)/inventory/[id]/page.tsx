import { notFound } from 'next/navigation';
import { getProfile, getUsers } from '@/server/data';
import { getInventoryDetail, getInventoryLocations } from '@/server/inventory';
import { InventoryDetailView } from '@/components/inventory/inventory-detail';

// Never cached: two people may be counting the same inventory at once, and
// the 18:00 lock has to be evaluated against the real clock on every load.
export const dynamic = 'force-dynamic';

export default async function InventoryDetailPage({ params }: { params: { id: string } }) {
  const profile = await getProfile();
  const isAdmin = profile?.role === 'admin';

  const [detail, locations] = await Promise.all([
    getInventoryDetail(params.id),
    // Only needed for packaging counts, but fetching it unconditionally keeps
    // the component contract simple and the list is two rows.
    getInventoryLocations(),
  ]);

  if (!detail) notFound();

  // The assign dialog is the only consumer, so a non-admin never pays for it.
  const users = isAdmin ? await getUsers() : [];

  return (
    <InventoryDetailView
      detail={detail}
      locations={locations}
      users={users}
      isAdmin={isAdmin}
    />
  );
}
