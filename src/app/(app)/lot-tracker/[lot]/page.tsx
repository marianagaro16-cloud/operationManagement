import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getLotDetail, getLotHistory } from '@/server/lot-tracker';
import { LotDetailView } from '@/components/orders/lot-detail-view';

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

  const [detail, history] = await Promise.all([
    getLotDetail(lotNumber),
    getLotHistory(lotNumber),
  ]);

  if (!detail) notFound();

  return <LotDetailView lotNumber={lotNumber} detail={detail} history={history} />;
}
