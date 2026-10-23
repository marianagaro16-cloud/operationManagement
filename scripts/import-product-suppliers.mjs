/**
 * Loads who supplies each product from the checked "proveedores por
 * producto" Excel (2026-10-23).
 *
 *   node scripts/import-product-suppliers.mjs <file.xlsx>           dry run
 *   node scripts/import-product-suppliers.mjs <file.xlsx> --apply   writes
 *
 * Reads the sheet "Proveedores por producto": the hidden id column names the
 * product, "Proveedor principal" the main supplier, "Otros proveedores" the
 * alternatives separated by ";". Names must match a supplier exactly (case
 * and accents aside); anything unknown is reported and that row skipped. A
 * row's list replaces what the product had; an empty row leaves it alone.
 *
 * Rows whose id reads "item:<uuid>" are raw materials and packaging — items
 * on the Materia Prima and Empaques inventory lists, not products — and go to
 * inventory_item_suppliers instead.
 */
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env', quiet: true });
const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/import-product-suppliers.mjs <file.xlsx> [--apply]');
  process.exit(1);
}
const apply = flag === '--apply';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const fold = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const { data: suppliers, error } = await admin.from('suppliers').select('id, name');
if (error) throw error;
const byName = new Map(suppliers.map((s) => [fold(s.name), s]));

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.getWorksheet('Proveedores por producto');
if (!ws) throw new Error('sheet "Proveedores por producto" not found');
const head = ws.getRow(1).values.slice(1).map((v) => String(v ?? ''));
const col = (label) => head.findIndex((h) => h.startsWith(label)) + 1;
const [cId, cProduct, cMain, cOthers] = [col('id'), col('Producto'), col('Proveedor principal'), col('Otros proveedores')];
if (!cId || !cMain || !cOthers) throw new Error('columns not found: id / Proveedor principal / Otros proveedores');
const text = (v) => {
  if (v == null) return '';
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  return String(v).trim();
};

const plan = [];
const problems = [];
ws.eachRow((row, n) => {
  if (n === 1) return;
  const productId = text(row.getCell(cId).value);
  const product = text(row.getCell(cProduct).value);
  const main = text(row.getCell(cMain).value);
  const others = text(row.getCell(cOthers).value).split(';').map((s) => s.trim()).filter(Boolean);
  if (!productId || (!main && others.length === 0)) return;
  const names = [...(main ? [main] : []), ...others.filter((o) => fold(o) !== fold(main))];
  const unknown = names.filter((nm) => !byName.has(fold(nm)));
  if (unknown.length) {
    problems.push(`row ${n} ${product}: unknown supplier ${unknown.map((u) => `"${u}"`).join(', ')}`);
    return;
  }
  const item = productId.startsWith('item:');
  plan.push({
    table: item ? 'inventory_item_suppliers' : 'product_suppliers',
    key: item ? 'item_id' : 'product_id',
    productId: item ? productId.slice(5) : productId,
    product,
    links: names.map((nm, i) => ({ supplier_id: byName.get(fold(nm)).id, is_main: Boolean(main) && i === 0 })),
  });
});

console.log(`${plan.filter((p) => p.key === 'product_id').length} products · ${plan.filter((p) => p.key === 'item_id').length} raw material / packaging items with suppliers · ${plan.filter((p) => p.links.length > 1).length} with alternatives`);
if (problems.length) {
  console.log(`Skipped (${problems.length}):`);
  for (const p of problems) console.log(`  ${p}`);
}
if (!apply) {
  console.log('\nDry run. Add --apply to write.');
  process.exit(0);
}

let written = 0;
for (const p of plan) {
  const { error: cleared } = await admin.from(p.table).delete().eq(p.key, p.productId);
  if (cleared) {
    console.error(`  ${p.product}: ${cleared.message}`);
    continue;
  }
  const { error: e } = await admin.from(p.table).insert(p.links.map((l) => ({ ...l, [p.key]: p.productId })));
  if (e) console.error(`  ${p.product}: ${e.message}`);
  else written++;
}
console.log(`\nWritten: ${written} rows.`);
