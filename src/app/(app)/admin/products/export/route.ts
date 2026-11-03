import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/server/data';
import { getCustomers, getProductCategories, getProductSubcategories, getProducts } from '@/server/orders';
import { getProductAliases } from '@/server/order-import';
import { getProductSuppliersMap, type ProductSupplier } from '@/server/suppliers';
import { getSuppliers } from '@/server/goods-reception';
import { workbook, XLSX_TYPE } from '@/server/xlsx';
import { filterProducts, productFiltersFromParams } from '@/domain/master/filters';
import { noteToPlainLine } from '@/domain/notes';
import { businessToday } from '@/lib/datetime';
import { localizedName } from '@/types/orders';

export const dynamic = 'force-dynamic';

/**
 * Gestión → Productos as a spreadsheet (2026-10-23): the rows on screen, with
 * the filters the link carries, in Spanish. Only for whoever manages the
 * products there. Since 2026-11-03 also the description, customer aliases and,
 * for the office only (as on screen), who supplies each product.
 */

/** numeric columns can arrive from Postgres as strings; empty stays empty. */
const num = (v: number | string | null) => (v === null || v === '' ? null : Number(v));

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved' || !viewer.can('products.manage')) {
    return new NextResponse('Not authorized', { status: 403 });
  }

  const office = viewer.role === 'owner' || viewer.role === 'admin' || viewer.role === 'power_user';
  const [all, categories, subcategories, aliases, customers, suppliers, productSuppliers] = await Promise.all([
    getProducts(true),
    getProductCategories(true),
    getProductSubcategories(true),
    getProductAliases(),
    getCustomers(true),
    office ? getSuppliers(true) : [],
    office ? getProductSuppliersMap() : ({} as Record<string, ProductSupplier[]>),
  ]);
  const products = filterProducts(all, productFiltersFromParams(request.nextUrl.searchParams));
  const category = new Map(categories.map((c) => [c.id, localizedName(c, 'es')]));
  const subcategory = new Map(subcategories.map((s) => [s.id, localizedName(s, 'es')]));
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const customerName = new Map(customers.map((c) => [c.id, c.company_name]));
  const aliasesOf = new Map<string, string[]>();
  for (const a of aliases) {
    const who = a.customer_id ? customerName.get(a.customer_id) : null;
    (aliasesOf.get(a.product_id) ?? aliasesOf.set(a.product_id, []).get(a.product_id)!).push(who ? `${a.alias} (${who})` : a.alias);
  }
  const withCode = (l: ProductSupplier) => [supplierName.get(l.supplier_id) ?? '', l.supplier_code ? `(${l.supplier_code})` : ''].filter(Boolean).join(' ');

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
      { header: 'Descripción', key: 'description', width: 50 },
      { header: 'Notas', key: 'notes', width: 40 },
      ...(office
        ? [
            { header: 'Proveedor principal', key: 'mainSupplier', width: 26 },
            { header: 'Código del proveedor', key: 'supplierCode', width: 14 },
            { header: 'Otros proveedores', key: 'otherSuppliers', width: 30 },
          ]
        : []),
      { header: 'Alias de clientes', key: 'aliases', width: 36 },
      { header: 'Requiere revisión', key: 'review', width: 10 },
      { header: 'Activo', key: 'active', width: 8 },
    ],
    products.map((p) => {
      const links = productSuppliers[p.id] ?? [];
      const main = links.find((l) => l.is_main);
      return {
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
        description: p.description ?? '',
        notes: noteToPlainLine(p.notes),
        mainSupplier: main ? supplierName.get(main.supplier_id) ?? '' : '',
        supplierCode: main?.supplier_code ?? '',
        otherSuppliers: links.filter((l) => !l.is_main).map(withCode).join('; '),
        aliases: (aliasesOf.get(p.id) ?? []).join('; '),
        review: p.needs_review ? 'Sí' : 'No',
        active: p.is_active ? 'Sí' : 'No',
      };
    }),
  );

  return new NextResponse(file as ArrayBuffer, {
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="productos-${businessToday()}.xlsx"`,
    },
  });
}
