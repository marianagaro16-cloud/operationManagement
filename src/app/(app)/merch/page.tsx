import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getMerchCampaigns, getMerchCustomerOptions, getMerchItems } from '@/server/merch';
import { getCustomerTypes } from '@/server/orders';
import { MerchHome } from '@/components/merch/merch-home';
import { canManageMerch } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Merch: Ventas, Admin, Owners, Managers and Power Users — guarded here as well as by RLS. */
export default async function MerchPage({ searchParams }: { searchParams: { tab?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!canManageMerch(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const tab = searchParams.tab === 'items' ? 'items' : 'campaigns';
  const [campaigns, items, customers, types] = await Promise.all([
    tab === 'campaigns' ? getMerchCampaigns() : Promise.resolve([]),
    getMerchItems(),
    tab === 'campaigns' ? getMerchCustomerOptions() : Promise.resolve([]),
    tab === 'campaigns' ? getCustomerTypes() : Promise.resolve([]),
  ]);
  return <MerchHome tab={tab} campaigns={campaigns} items={items} customers={customers} types={types} today={businessToday()} />;
}
