import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getViewer } from '@/server/data';
import { getReceptionReportSnapshot } from '@/server/goods-reception';
import { ReceptionReportView } from '@/components/admin/reception-report-view';
import type { ReceptionReportPayload } from '@/domain/goods-reception/report';

export const dynamic = 'force-dynamic';

/**
 * One frozen report, exactly as it was generated.
 *
 * The payload is rendered straight from the stored jsonb and is NOT
 * recomputed — that is the whole point of §42. A reception corrected in
 * November does not change what October's report said in November's first
 * week, and the only way to guarantee that is to never recompute.
 */
export default async function ReceptionReportPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer?.can('reports.view')) redirect('/admin');

  const snapshot = await getReceptionReportSnapshot(params.id);
  if (!snapshot) notFound();

  return (
    <>
      <Link
        href="/admin/goods-reception-reports"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Reports
      </Link>
      <ReceptionReportView payload={snapshot.payload as ReceptionReportPayload} />
    </>
  );
}
