import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getActivityKinds, getCustomerFile, getWonFrom } from '@/server/sales';
import { CustomerFile } from '@/components/sales/customer-file';
import { getCustomerCases, getFlaggedCustomers, getPrepayFirstOrders, isCollections } from '@/server/collections';
import { customerPrepay } from '@/server/collection-actions';
import { getNotes } from '@/server/notes';
import { getActaTopics, getTargetActas } from '@/server/sales-actas';
import { isSales } from '@/lib/authz';
import { getMerchHistory, getMerchItems } from '@/server/merch';
import { businessToday } from '@/lib/datetime';
import { getCustomerDetails, getCustomerWebsite } from '@/server/orders';

export const dynamic = 'force-dynamic';

export default async function SalesCustomerPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const today = businessToday();
  const [view, wonFrom, kinds, flagged, team, prepay, prepayFirst, quickNotes, actaTopics, merchHistory, merchItems, details, website] = await Promise.all([
    getCustomerFile(params.id),
    getWonFrom(params.id),
    getActivityKinds(true),
    getFlaggedCustomers(),
    isCollections(),
    customerPrepay(params.id),
    getPrepayFirstOrders(),
    getNotes({ customerId: params.id }),
    getActaTopics(true),
    getMerchHistory({ customerId: params.id }),
    getMerchItems(),
    getCustomerDetails(params.id),
    getCustomerWebsite(params.id),
  ]);
  if (!view) notFound();
  // The collections team sees the cases; everyone else only that payments are pending.
  const [cases, actas] = await Promise.all([
    team ? getCustomerCases(params.id) : null,
    // Meetings held while they were a prospect are in this file too.
    getTargetActas({ customerId: params.id, wonFromId: wonFrom?.id ?? null }, today),
  ]);
  return (
    <CustomerFile
      view={view}
      wonFromId={wonFrom?.id ?? null}
      contact={{ details, website }}
      kinds={kinds}
      viewerId={viewer.profile.id}
      today={today}
      quickNotes={quickNotes}
      actas={actas}
      actaTopics={actaTopics}
      merch={{ history: merchHistory, items: merchItems }}
      collections={{ flagged: flagged.get(params.id) ?? null, prepay, prepayFirst: prepayFirst.find((c) => c.id === params.id && c.counted < c.first) ?? null, cases }}
    />
  );
}
