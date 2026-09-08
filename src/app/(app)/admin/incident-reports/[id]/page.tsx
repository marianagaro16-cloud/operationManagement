import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getReportSnapshot, getReportSnapshots } from '@/server/incidents';
import { IncidentReportView } from '@/components/incidents/incident-report-view';

export const dynamic = 'force-dynamic';

/**
 * One saved report.
 *
 * Rendered from the FROZEN payload and from nothing else — no incident is
 * read here, so an investigation edited in December cannot move a September
 * number. That is the whole promise of §26 and §42, and it is kept by this
 * page having no access to live data at all.
 */
export default async function IncidentReportSnapshotPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await getViewer();
  if (!viewer?.can('incidents.view_all')) redirect('/dashboard');

  const snapshot = await getReportSnapshot(params.id);
  if (!snapshot) notFound();

  // The nearest saved report from an earlier month, so a historical report can
  // be read against the one before it exactly as the live view can.
  const all = await getReportSnapshots();
  const previous = all.find(
    (s) => s.period_month < snapshot.period_month && s.id !== snapshot.id,
  );

  return (
    <IncidentReportView
      payload={snapshot.payload}
      month={snapshot.period_month.slice(0, 7)}
      snapshot={snapshot}
      previous={previous}
      canGenerate={false}
    />
  );
}
