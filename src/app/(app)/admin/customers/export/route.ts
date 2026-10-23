import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/server/data';
import { getCustomers } from '@/server/orders';
import { workbook, XLSX_TYPE } from '@/server/xlsx';
import { customerFiltersFromParams, filterCustomers } from '@/domain/master/filters';
import { noteToPlainLine } from '@/domain/notes';
import { businessToday } from '@/lib/datetime';
import { es } from '@/i18n/messages/es';
import type { Customer } from '@/types/orders';

export const dynamic = 'force-dynamic';

/**
 * Gestión → Clientes as a spreadsheet (2026-10-23): the rows on screen, with
 * the filters the link carries, in Spanish. Only for whoever manages the
 * customers there.
 */

const TYPE_ES = es.master.customerType as Record<string, string>;

function prepayment(c: Customer & { prepay_first_orders?: number | null }): string {
  if (c.prepay_required) return 'Siempre';
  const n = c.prepay_first_orders ?? 0;
  return n > 0 ? (n === 1 ? 'Primer pedido' : `Primeros ${n} pedidos`) : '';
}

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved' || !viewer.can('customers.manage')) {
    return new NextResponse('Not authorized', { status: 403 });
  }

  const customers = filterCustomers(await getCustomers(true), customerFiltersFromParams(request.nextUrl.searchParams));
  const file = await workbook(
    'Clientes',
    [
      { header: 'Empresa', key: 'company', width: 32 },
      { header: 'Complemento del nombre', key: 'addition', width: 28 },
      { header: 'Tipo', key: 'type', width: 14 },
      { header: 'Calle', key: 'street', width: 30 },
      { header: 'Código postal', key: 'postal', width: 12 },
      { header: 'Ciudad', key: 'city', width: 18 },
      { header: 'País', key: 'country', width: 8 },
      { header: 'Notas de entrega', key: 'notes', width: 40 },
      { header: 'Pago por adelantado', key: 'prepay', width: 20 },
      { header: 'Activo', key: 'active', width: 8 },
    ],
    customers.map((c) => ({
      company: c.company_name,
      addition: c.company_name_addition ?? '',
      type: c.customer_type ? TYPE_ES[c.customer_type.slug] ?? c.customer_type.name : 'Sin tipo',
      street: c.street ?? '',
      postal: c.postal_code ?? '',
      city: c.city ?? '',
      country: c.country ?? '',
      notes: noteToPlainLine(c.delivery_notes),
      prepay: prepayment(c),
      active: c.is_active ? 'Sí' : 'No',
    })),
  );

  return new NextResponse(file as ArrayBuffer, {
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="clientes-${businessToday()}.xlsx"`,
    },
  });
}
