import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getActivityKinds, getCustomerFile, getWonFrom } from '@/server/sales';
import { CustomerFile } from '@/components/sales/customer-file';
import { getCustomerCases, getFlaggedCustomers, isCollections } from '@/server/collections';
import { customerPrepay } from '@/server/collection-actions';
import { getNotes } from '@/server/notes';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function SalesCustomerPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const [view, wonFrom, kinds, flagged, team, prepay, quickNotes] = await Promise.all([
    getCustomerFile(params.id),
    getWonFrom(params.id),
    getActivityKinds(true),
    getFlaggedCustomers(),
    isCollections(),
    customerPrepay(params.id),
    getNotes({ customerId: params.id }),
  ]);
  if (!view) notFound();
  // The collections team sees the cases; everyone else only that payments are pending.
  const cases = team ? await getCustomerCases(params.id) : null;
  return (
    <CustomerFile
      view={view}
      wonFromId={wonFrom?.id ?? null}
      kinds={kinds}
      viewerId={viewer.profile.id}
      today={businessToday()}
      quickNotes={quickNotes}
      collections={{ flagged: flagged.get(params.id) ?? null, prepay, cases }}
    />
  );
}
