import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getCustomerFile } from '@/server/sales';
import { CustomerFile } from '@/components/sales/customer-file';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function SalesCustomerPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const view = await getCustomerFile(params.id);
  if (!view) notFound();
  return <CustomerFile view={view} today={businessToday()} />;
}
