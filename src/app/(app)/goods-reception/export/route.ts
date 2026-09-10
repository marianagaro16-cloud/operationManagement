import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/server/data';
import { getReceptionsForExport } from '@/server/goods-reception';
import { receptionsToCsv } from '@/domain/goods-reception/export';
import {
  isQuantityCheck,
  isReceptionCondition,
  isReceptionStatus,
} from '@/domain/goods-reception/vocabulary';
import type { ReceptionFilters } from '@/types/goods-reception';

export const dynamic = 'force-dynamic';

/**
 * The filtered reception list, as a spreadsheet.
 *
 * A route rather than a client-side blob because the rows have to be fetched
 * under the caller's own session for RLS to apply — an export built in the
 * browser could only ever contain the one page the browser already had.
 *
 * It runs the SAME filters the list ran, from the same query string, so the
 * file matches the screen it was taken from. §46.
 */
const EXPORT_LIMIT = 5000;

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') {
    return new NextResponse('Not authorized', { status: 403 });
  }

  // §46: exporting is a bulk read, so it takes the capability that reading
  // reports takes. RLS would filter the rows anyway; this refuses the file
  // rather than handing over an empty one.
  if (!viewer.can('reports.export')) {
    return new NextResponse('Not authorized', { status: 403 });
  }

  const p = request.nextUrl.searchParams;
  const one = (key: string) => p.get(key) || undefined;

  const status = one('status');
  const condition = one('condition');
  const quantity = one('quantity');
  const incidents = one('incidents');

  const filters: ReceptionFilters = {
    search: one('q'),
    from: one('from') ? `${one('from')}T00:00:00+02:00` : undefined,
    to: one('to') ? `${one('to')}T23:59:59+02:00` : undefined,
    supplierId: one('supplier'),
    transporterId: one('transporter'),
    receivedBy: one('receiver'),
    status: status && isReceptionStatus(status) ? status : undefined,
    condition: condition && isReceptionCondition(condition) ? condition : undefined,
    quantityCheck: quantity && isQuantityCheck(quantity) ? quantity : undefined,
    incidents: incidents === 'with' || incidents === 'without' ? incidents : undefined,
  };

  const rows = await getReceptionsForExport(filters, EXPORT_LIMIT);
  const csv = receptionsToCsv(rows);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());

  return new NextResponse(`﻿${csv}`, {
    headers: {
      // The BOM above is what makes Excel read the file as UTF-8 rather than
      // as the system codepage, which is the difference between "Käserei" and
      // "KÃ¤serei" in every Swiss office that opens it.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="goods-reception-${today}.csv"`,
    },
  });
}
