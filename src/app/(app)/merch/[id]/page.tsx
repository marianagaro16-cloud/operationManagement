import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getMerchCampaign, getMerchCustomerOptions, getMerchItems } from '@/server/merch';
import { getCustomerTypes } from '@/server/orders';
import { CampaignView } from '@/components/merch/campaign-view';
import { canManageMerch, isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function MerchCampaignPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!canManageMerch(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const [found, items, customers, types] = await Promise.all([
    getMerchCampaign(params.id),
    getMerchItems(),
    getMerchCustomerOptions(),
    getCustomerTypes(),
  ]);
  if (!found) notFound();
  return (
    <CampaignView
      {...found}
      items={items}
      customers={customers}
      types={types}
      today={businessToday()}
      customerLinks={isSales(viewer.role, viewer.profile.team)}
    />
  );
}
