import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/server/data';
import { getProductCategories, getProductSubcategories, getProducts } from '@/server/orders';
import { workbook, XLSX_TYPE } from '@/server/xlsx';
import { filterProducts, productFiltersFromParams } from '@/domain/master/filters';
import { noteToPlainLine } from '@/domain/notes';
import { businessToday } from '@/lib/datetime';
import { localizedName } from '@/types/orders';

export const dynamic = 'force-dynamic';

/**
 * Gestión → Productos as a spreadsheet (2026-10-23): the rows on screen, with
 * the filters the link carries, in Spanish. Only for whoever manages the
 * products there.
 */

/** numeric columns can arrive from Postgres as strings; empty stays empty. */
const num = (v: number | string | null) => (v === null || v === '' ? null : Number(v));

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved' || !viewer.can('products.manage')) {
    return new NextResponse('Not authorized', { status: 403 });
  }

  const [all, categories, subcategories] = await Promise.all([
    getProducts(true),
    getProductCategories(true),
    getProductSubcategories(true),
  ]);
  const products = filterProducts(all, productFiltersFromParams(request.nextUrl.searchParams));
  const category = new Map(categories.map((c) => [c.id, localizedName(c, 'es')]));
  const subcategory = new Map(subcategories.map((s) => [s.id, localizedName(s, 'es')]));

  const file = await workbook(
    'Productos',
    [
      { header: 'Código', key: 'code', width: 12 },
      { header: 'Nombre', key: 'name', width: 40 },
      { header: 'Marca', key: 'brand', width: 16 },
      { header: 'Categoría', key: 'category', width: 18 },
      { header: 'Subcategoría', key: 'subcategory', width: 16 },
      { header: 'Familia', key: 'family', width: 22 },
      { header: 'Presentación', key: 'presentation', width: 18 },
      { header: 'Unidades por caja', key: 'perBox', width: 10 },
      { header: 'Peso neto (kg)', key: 'net', width: 10 },
      { header: 'Peso bruto (kg)', key: 'gross', width: 10 },
      { header: 'Notas', key: 'notes', width: 40 },
      { header: 'Activo', key: 'active', width: 8 },
    ],
    products.map((p) => ({
      code: p.code ?? '',
      name: p.name ?? '',
      brand: p.brand?.name ?? '',
      category: p.category_id ? category.get(p.category_id) ?? '' : '',
      subcategory: p.subcategory_id ? subcategory.get(p.subcategory_id) ?? '' : '',
      family: p.family,
      presentation: p.presentation === '—' ? '' : p.presentation,
      perBox: num(p.units_per_box),
      net: num(p.net_weight_kg),
      gross: num(p.gross_weight_kg),
      notes: noteToPlainLine(p.notes),
      active: p.is_active ? 'Sí' : 'No',
    })),
  );

  return new NextResponse(file as ArrayBuffer, {
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="productos-${businessToday()}.xlsx"`,
    },
  });
}
