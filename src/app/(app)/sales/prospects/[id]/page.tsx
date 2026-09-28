import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getCustomerTypes, getProspectLists, getProspect, getSalesPeople } from '@/server/sales';
import { ProspectView } from '@/components/sales/prospect-view';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function ProspectPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');

  const [found, people, customerTypes, lists] = await Promise.all([
    getProspect(params.id),
    getSalesPeople(),
    getCustomerTypes(),
    getProspectLists(true),
  ]);
  if (!found) notFound();

  return (
    <ProspectView
      prospect={found.prospect}
      notes={found.notes}
      choices={{ people, customerTypes, ...lists, viewerId: viewer.profile.id }}
      customerTypeName={customerTypes.find((c) => c.id === found.prospect.customer_type_id)?.name ?? null}
      today={businessToday()}
    />
  );
}
