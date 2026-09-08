import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getLotDetail, getLotHistory } from '@/server/lot-tracker';
import { getIncidentsForLot } from '@/server/incidents';
import { LotDetailView } from '@/components/orders/lot-detail-view';
import { IncidentLinks } from '@/components/incidents/incident-links';

export const dynamic = 'force-dynamic';

/**
 * One lot number, everywhere it was used.
 *
 * A lot number is NOT unique — the same number legitimately belongs to
 * different products — so this is a group of allocations rather than a
 * record, and every row carries its own product, customer and order context.
 */
export default async function LotDetailPage({ params }: { params: { lot: string } }) {
  const viewer = await getViewer();
  if (!viewer?.can('orders.manage')) redirect('/dashboard');

  const lotNumber = decodeURIComponent(params.lot);

  // §32: the Tracker still answers "where was this lot used" and Incidents
  // still answers "what went wrong". This is a link between them, resolved
  // through the allocation the Tracker already owns — not a second lot store.
  const [detail, history, incidents] = await Promise.all([
    getLotDetail(lotNumber),
    getLotHistory(lotNumber),
    getIncidentsForLot(lotNumber),
  ]);

  if (!detail) notFound();

  return (
    <>
      <LotDetailView lotNumber={lotNumber} detail={detail} history={history} />
      {incidents.length > 0 && (
        <div className="mt-4">
          <IncidentLinks incidents={incidents} variant="lot" />
        </div>
      )}
    </>
  );
}
