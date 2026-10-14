import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getMerchItem } from '@/server/merch';
import { ItemView } from '@/components/merch/item-view';
import { canManageMerch, isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function MerchItemPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!canManageMerch(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const found = await getMerchItem(params.id);
  if (!found) notFound();
  return <ItemView {...found} today={businessToday()} customerLinks={isSales(viewer.role, viewer.profile.team)} />;
}
