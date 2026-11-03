/**
 * Fills the app's product descriptions from a bexio product export (.xlsx).
 *
 *   node scripts/import-bexio-products.mjs <export.xlsx>           dry run: what would change
 *   node scripts/import-bexio-products.mjs <export.xlsx> --apply   writes it
 *
 * A product is found by its code ("Product code" in bexio). Only products
 * already in the app are touched; other bexio articles are ignored.
 *
 * The app wins: a description already filled here is never overwritten, so the
 * script can be run again after edits in Administrar → Productos.
 */
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env', quiet: true });
const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/import-bexio-products.mjs <export.xlsx> [--apply]');
  process.exit(1);
}
const apply = flag === '--apply';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------- reading the export ----------

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.worksheets[0];
const head = ws.getRow(1).values.slice(1);
const col = (name) => {
  const i = head.indexOf(name);
  if (i < 0) throw new Error(`column "${name}" not in the export`);
  return i + 1;
};
const CODE = col('Product code');
const DESC = col('Product description');
const text = (v) => {
  if (v == null) return '';
  if (typeof v === 'object' && 'text' in v) v = v.text;
  if (typeof v === 'object' && 'result' in v) v = v.result;
  return String(v);
};
// bexio's plain-text column still carries non-breaking spaces and trailing
// blanks from its editor: tidy those, keep the line breaks.
const tidy = (s) =>
  s.replace(/ /g, ' ').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();

const bexio = new Map();
ws.eachRow((row, n) => {
  if (n === 1) return;
  const code = text(row.getCell(CODE).value).trim();
  const description = tidy(text(row.getCell(DESC).value));
  if (code && description) bexio.set(code, description);
});

// ---------- matching ----------

const { data: products, error } = await admin.from('products').select('id, code, name, description').not('code', 'is', null);
if (error) throw error;

const fill = [];
let kept = 0;
let missing = 0;
for (const p of products) {
  const description = bexio.get(p.code.trim());
  if (!description) { missing++; continue; }
  if (p.description) { kept++; continue; }
  fill.push({ ...p, description });
}

console.log(`bexio articles with a description: ${bexio.size}`);
console.log(`app products with a code: ${products.length}`);
console.log(`  to fill: ${fill.length}`);
console.log(`  already have one (kept): ${kept}`);
console.log(`  no description in bexio: ${missing}`);
for (const p of fill.slice(0, 5)) console.log(`\n${p.code} ${p.name}\n  ${p.description.replace(/\n/g, '\n  ')}`);

if (!apply) {
  console.log('\nDry run. Add --apply to write.');
  process.exit(0);
}
let done = 0;
for (const p of fill) {
  // Guarded again here: an edit made since the read still wins.
  const { error: e } = await admin.from('products').update({ description: p.description }).eq('id', p.id).is('description', null);
  if (e) throw e;
  done++;
}
console.log(`\nWritten: ${done}`);
