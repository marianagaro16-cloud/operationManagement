import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getActivityKinds, getCustomerFile, getWonFrom } from '@/server/sales';
import { CustomerFile } from '@/components/sales/customer-file';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function SalesCustomerPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const [view, wonFrom, kinds] = await Promise.all([getCustomerFile(params.id), getWonFrom(params.id), getActivityKinds(true)]);
  if (!view) notFound();
  return (
    <CustomerFile
      view={view}
      wonFromId={wonFrom?.id ?? null}
      kinds={kinds}
      viewerId={viewer.profile.id}
      today={businessToday()}
    />
  );
}
