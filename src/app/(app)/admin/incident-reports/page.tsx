import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getViewer } from '@/server/data';
import { getLiveReport, getReportSnapshots } from '@/server/incidents';
import { monthRange } from '@/domain/orders/scheduling';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { IncidentReportView } from '@/components/incidents/incident-report-view';

export const dynamic = 'force-dynamic';

/**
 * The live monthly report, plus the history of saved ones.
 *
 * "Live" is honest about itself: it is recomputed on every visit and moves as
 * incidents are edited. Freezing it is a deliberate act with a button, and
 * what that button stores is exactly this payload — §42.
 */
export default async function IncidentReportsPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const viewer = await getViewer();
  if (!viewer?.can('incidents.view_all')) redirect('/dashboard');

  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '')
    ? (searchParams.month as string)
    : DateTime.fromISO(businessToday(), { zone: BUSINESS_TZ }).toFormat('yyyy-MM');

  const { start, end } = monthRange(month);

  const [payload, snapshots] = await Promise.all([
    getLiveReport(month, start, end),
    getReportSnapshots(),
  ]);

  // The most recent saved report from an EARLIER month, for the comparison.
  // A saved report of the same month is not a comparison, it is this month.
  const previous = snapshots.find((s) => s.period_month < `${month}-01`);

  return (
    <IncidentReportView
      payload={payload}
      month={month}
      previous={previous}
      snapshots={snapshots}
      canGenerate={viewer.can('incidents.manage')}
    />
  );
}
