import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getSummary } from '@/server/sales-summary';
import { PrintSummary } from '@/components/summaries/print-summary';

export const dynamic = 'force-dynamic';

/** A summary on a plain page, without the app around it, to print or save as PDF. */
export default async function PrintSummaryRoute({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const summary = await getSummary(params.id);
  if (!summary) notFound();
  return <PrintSummary summary={summary} />;
}
