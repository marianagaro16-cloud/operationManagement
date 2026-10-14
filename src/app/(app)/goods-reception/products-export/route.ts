import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/server/data';
import { getReceivedProducts } from '@/server/goods-reception';
import { receivedProductsToCsv } from '@/domain/goods-reception/export';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const UNIT_ES: Record<string, string> = { units: 'uds', boxes: 'cajas', kg: 'kg', pallets: 'pallets', bags: 'bolsas', liters: 'litros' };

/**
 * "Productos recibidos" as a spreadsheet, with the same filters as the
 * screen. Takes the capability every export takes; RLS still decides rows.
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved' || !viewer.can('reports.export')) {
    return new NextResponse('Not authorized', { status: 403 });
  }

  const p = request.nextUrl.searchParams;
  const month = p.get('month') || businessToday().slice(0, 7);
  const rows = await getReceivedProducts(
    {
      month: month === 'all' ? undefined : month,
      supplierId: p.get('supplier') || undefined,
      search: p.get('q') || undefined,
      byBestBefore: p.get('sort') === 'best_before',
    },
    5000,
  );

  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' });
  const csv = receivedProductsToCsv(
    rows.map((r) => ({
      received_on: day.format(new Date(r.reception.received_at)),
      supplier: r.reception.supplier_name,
      delivery_note: r.reception.delivery_note,
      reception_number: r.reception.reception_number,
      product_code: r.product_code,
      product: r.product_name,
      quantity: r.quantity,
      unit: UNIT_ES[r.unit] ?? r.unit,
      best_before: r.best_before,
      lot_number: r.lot_number,
      note: r.note,
    })),
  );

  return new NextResponse(`﻿${csv}`, {
    headers: {
      // The BOM makes Excel read UTF-8: "Käserei", not "KÃ¤serei".
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="productos-recibidos-${month}.csv"`,
    },
  });
}
