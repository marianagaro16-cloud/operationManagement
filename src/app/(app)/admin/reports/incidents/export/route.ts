import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/server/data';
import { getLiveReport, getReportSnapshot } from '@/server/incidents';
import { reportToCsv } from '@/domain/incidents/export';
import { monthRange } from '@/domain/orders/scheduling';
import { resolveLocale, LOCALE_COOKIE } from '@/i18n/config';
import { en } from '@/i18n/messages/en';
import { es } from '@/i18n/messages/es';
import { de } from '@/i18n/messages/de';
import { vocabularyKey } from '@/domain/incidents/vocabulary';

export const dynamic = 'force-dynamic';

/**
 * The monthly report as a spreadsheet.
 *
 * Exports the SAVED payload when a snapshot is named and the live one
 * otherwise, so a historical export is the frozen document rather than a
 * recomputation of it — which would defeat the point of having saved it.
 *
 * Labels come from the viewer's own dictionary, so a Spanish manager gets a
 * Spanish file. The stable keys are exported alongside them, so two files in
 * two languages remain joinable.
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.can('incidents.view_all')) {
    return new NextResponse('Not authorized', { status: 403 });
  }

  const snapshotId = request.nextUrl.searchParams.get('snapshot');
  const month = request.nextUrl.searchParams.get('month') ?? '';

  let payload;
  let label: string;

  if (snapshotId) {
    const snapshot = await getReportSnapshot(snapshotId);
    if (!snapshot) return new NextResponse('Not found', { status: 404 });
    payload = snapshot.payload;
    label = `${snapshot.period_month.slice(0, 7)}-v${snapshot.version}`;
  } else {
    if (!/^\d{4}-\d{2}$/.test(month)) return new NextResponse('Bad request', { status: 400 });
    const { start, end } = monthRange(month);
    payload = await getLiveReport(month, start, end);
    label = month;
  }

  const dict = { en, es, de }[
    resolveLocale(request.cookies.get(LOCALE_COOKIE)?.value)
  ];

  /**
   * Section-aware lookup into the dictionary.
   *
   * A summary key is a report label; a category, type, cause or
   * responsibility key is vocabulary. Anything unrecognised falls back to the
   * key itself, which is visible in the file rather than silently blank.
   */
  const translate = (section: string, key: string): string => {
    const camel = vocabularyKey(key);
    const table: Record<string, Record<string, string> | undefined> = {
      summary: dict.ireport as unknown as Record<string, string>,
      corrective_actions: dict.ireport as unknown as Record<string, string>,
      category: dict.incident.category as unknown as Record<string, string>,
      type: dict.incident.type as unknown as Record<string, string>,
      severity: dict.incident.severity as unknown as Record<string, string>,
      primary_cause: dict.incident.cause as unknown as Record<string, string>,
      secondary_cause: dict.incident.cause as unknown as Record<string, string>,
      responsibility: dict.incident.responsibility as unknown as Record<string, string>,
      incident_type: dict.incident.type as unknown as Record<string, string>,
      // Brands are proper nouns and carry their own label; only the
      // unclassified bucket needs translating.
      brand: { __none__: dict.master.noBrand },
    };
    // Summary keys are already camelCase; vocabulary keys are snake_case.
    return table[section]?.[camel] ?? table[section]?.[key] ?? key;
  };

  const csv = reportToCsv(payload, translate);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="incident-report-${label}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
