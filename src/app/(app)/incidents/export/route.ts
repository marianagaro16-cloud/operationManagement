import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/server/data';
import { getIncidentsForExport } from '@/server/incidents';
import { incidentsToCsv } from '@/domain/incidents/export';
import {
  isCause,
  isResponsibility,
  isSeverity,
  isStatus,
} from '@/domain/incidents/vocabulary';
import type { IncidentFilters } from '@/types/incidents';

export const dynamic = 'force-dynamic';

/**
 * The filtered incident list, as a spreadsheet.
 *
 * A route rather than a client-side blob because the rows have to be fetched
 * under the caller's own session for RLS to apply — an export built in the
 * browser could only ever contain what the browser already had, which is one
 * page.
 *
 * It runs the SAME filters the list ran, so the file matches the screen it
 * was taken from. §28.
 */
const EXPORT_LIMIT = 5000;

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') {
    return new NextResponse('Not authorized', { status: 403 });
  }
  // Exporting is a bulk read of operational findings, so it takes the
  // capability that seeing all of them takes. RLS would filter the rows
  // anyway; this refuses the file rather than handing over an empty one.
  if (!viewer.can('incidents.view_all')) {
    return new NextResponse('Not authorized', { status: 403 });
  }

  const p = request.nextUrl.searchParams;
  const filters: IncidentFilters = {
    from: match(p.get('from'), /^\d{4}-\d{2}-\d{2}$/),
    to: match(p.get('to'), /^\d{4}-\d{2}-\d{2}$/),
    customerId: match(p.get('customerId'), UUID),
    productId: match(p.get('productId'), UUID),
    orderId: match(p.get('orderId'), UUID),
    categoryId: match(p.get('categoryId'), UUID),
    typeId: match(p.get('typeId'), UUID),
    deliveryMethodId: match(p.get('deliveryMethodId'), UUID),
    primaryCause: pick(p.get('primaryCause'), isCause),
    responsibility: pick(p.get('responsibility'), isResponsibility),
    severity: pick(p.get('severity'), isSeverity),
    status: pick(p.get('status'), isStatus),
    replacement: p.get('replacement') === 'with' || p.get('replacement') === 'without'
      ? (p.get('replacement') as 'with' | 'without') : undefined,
    action: ['none', 'open', 'done'].includes(p.get('action') ?? '')
      ? (p.get('action') as 'none' | 'open' | 'done') : undefined,
    q: p.get('q')?.trim() || undefined,
  };

  const rows = await getIncidentsForExport(filters, EXPORT_LIMIT);

  const csv = incidentsToCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      // Excel in a German/Swiss locale needs the BOM to read UTF-8 correctly.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="incidents-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

const UUID = /^[0-9a-f-]{36}$/i;

function match(value: string | null, pattern: RegExp): string | undefined {
  return value && pattern.test(value) ? value : undefined;
}

function pick<T extends string>(
  value: string | null,
  guard: (v: string) => v is T,
): T | undefined {
  return value && guard(value) ? value : undefined;
}
