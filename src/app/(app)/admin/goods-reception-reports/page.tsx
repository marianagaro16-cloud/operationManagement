import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import {
  buildLiveReceptionReport,
  getReceptionReportSnapshots,
} from '@/server/goods-reception';
import { ReceptionReports } from '@/components/admin/reception-reports';
import { resolveLocale } from '@/i18n/config';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE } from '@/i18n/config';

export const dynamic = 'force-dynamic';

/**
 * Monthly reception reports.
 *
 * The live month is computed here by the SAME domain function a snapshot
 * freezes, so the block at the top of the screen and the document generated
 * from it can never disagree.
 */
export default async function ReceptionReportsPage() {
  const viewer = await getViewer();
  if (!viewer?.can('reports.view')) redirect('/admin');

  const month = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Europe/Zurich',
  })
    .format(new Date())
    .slice(0, 7);

  // The label for rows with no supplier recorded. Resolved server-side in the
  // viewer's own language, because the domain layer takes it as an argument
  // rather than importing a dictionary.
  const locale = resolveLocale(cookies().get(LOCALE_COOKIE)?.value);
  const unrecorded =
    locale === 'es' ? 'Sin registrar' : locale === 'de' ? 'Nicht erfasst' : 'Not recorded';

  const [live, snapshots] = await Promise.all([
    buildLiveReceptionReport(month, unrecorded),
    getReceptionReportSnapshots(),
  ]);

  return (
    <ReceptionReports
      liveMonth={month}
      livePayload={live.payload}
      snapshots={snapshots}
      canGenerate={viewer.can('reports.view')}
    />
  );
}
