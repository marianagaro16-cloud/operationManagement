/**
 * Fills the suppliers' details (supplier_details) from a bexio contacts export.
 *
 *   node scripts/import-bexio-suppliers.mjs <export.xlsx>           dry run
 *   node scripts/import-bexio-suppliers.mjs <export.xlsx> --apply   writes
 *
 * Supplier names in the app are short ("Geiser", "Coop") and bexio's are the
 * legal names, so matching by name alone pairs "Mercanto" with a restaurant.
 * The pairs are therefore listed here by hand (bexio contact number), checked
 * on 2026-10-23; a supplier found by bexio number on an earlier run is found
 * again that way. The app wins: a filled field is never overwritten.
 */
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env', quiet: true });
const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/import-bexio-suppliers.mjs <export.xlsx> [--apply]');
  process.exit(1);
}
const apply = flag === '--apply';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** App supplier name → bexio contact number. */
const PAIRS = {
  'Nuevo Progreso': 773,
  Angst: 639,
  Geiser: 177,
  Intercheese: 620,
  'Käserei Stofel': 112,
  Crevel: 653,
  'El Sol': 9,
  "Rockin' Lemons": 799,
  Coop: 682,
  Pistor: 486,
  Pacovis: 519,
  'Rovey Seed': 3,
  'WIRmachenDRUCK AG': 526,
  'Elis (Suisse) AG': 701,
  Linde: 484,
  'Premium Trade (Swiss) Sarl': 803,
  Galaxus: 518,
  Rajapack: 527,
  'Euelbräu GmbH': 609,
  Bianchi: 730,
  'ENTOMOS AG': 788,
  'Importaciones Cuesta': 718,
  'KFN - Kalkfabrik Netstal AG': 565,
  'IFCO SYSTEMS (Schweiz) GmbH': 525,
  'Daga Plus Printing House': 647,
  'pb-onlinehandel': 517,
  Packartis: 816,
};

const COUNTRY = {
  Switzerland: 'CH', Germany: 'DE', Denmark: 'DK', Slovakia: 'SK', France: 'FR', Italy: 'IT', Austria: 'AT',
  Liechtenstein: 'LI', Spain: 'ES', Netherlands: 'NL', Belgium: 'BE', Luxembourg: 'LU', Mexico: 'MX', Sweden: 'SE',
  'Czech Republic': 'CZ', Czechia: 'CZ', Bulgaria: 'BG', 'United States': 'US', USA: 'US',
};

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.worksheets[0];
const head = ws.getRow(1).values.slice(1);
const cell = (v) => {
  if (v == null) return null;
  if (typeof v === 'object' && 'text' in v) v = v.text;
  if (typeof v === 'object' && 'result' in v) v = v.result;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const byNo = new Map();
ws.eachRow((row, n) => {
  if (n === 1) return;
  const o = {};
  head.forEach((h, i) => (o[h] = cell(row.getCell(i + 1).value)));
  byNo.set(Number(o['Contact no.']), o);
});

function phone(v) {
  if (!v) return null;
  if (/^\d{9}$/.test(v)) return `0${v}`;
  if (/^[1-9]\d{9,12}$/.test(v)) return `+${v}`;
  return v;
}
function street(c) {
  if (c['Street']) return [c['Street'], c['House no.']].filter(Boolean).join(' ').trim();
  const lines = (c['Address'] ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.at(-1) ?? null;
}

const { data: suppliers, error } = await admin.from('suppliers').select('id, name');
if (error) throw error;
const { data: existing } = await admin.from('supplier_details').select('*');
const current = new Map((existing ?? []).map((d) => [d.supplier_id, d]));

const plan = [];
const missing = [];
for (const [name, no] of Object.entries(PAIRS)) {
  const supplier = suppliers.find((s) => s.name === name);
  const c = byNo.get(no);
  if (!supplier || !c) {
    missing.push(`${name} (${!supplier ? 'not in the app' : `bexio ${no} not in the file`})`);
    continue;
  }
  const bexio = {
    bexio_no: no,
    email: c['Email'] ?? c['Email 2'],
    phone: phone(c['Phone']),
    mobile: phone(c['Mobile']),
    website: c['Website'],
    street: street(c),
    postal_code: c['Postcode'],
    city: c['City'],
    country: COUNTRY[c['Country']] ?? null,
    vat_no: c['VAT no.'],
    uid_no: c['VAT identification number'],
    notes: c['Remarks'],
  };
  const now = current.get(supplier.id);
  const fill = {};
  for (const [k, v] of Object.entries(bexio)) if (v != null && (now?.[k] == null || now[k] === '')) fill[k] = v;
  plan.push({ supplier, contact: c, fill, isNew: !now });
}

console.log(`${plan.length} suppliers to complete from bexio`);
for (const p of plan) {
  const f = p.fill;
  console.log(`  ${p.supplier.name.padEnd(28)} ← bexio ${p.contact['Contact no.']} ${p.contact['Company name'] ?? ''} | ${[f.email, f.phone, [f.street, f.postal_code, f.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}`);
}
if (missing.length) console.log(`Not done: ${missing.join(', ')}`);

if (!apply) {
  console.log('\nDry run. Add --apply to write.');
  process.exit(0);
}
let written = 0;
for (const p of plan) {
  if (Object.keys(p.fill).length === 0) continue;
  const { error: e } = p.isNew
    ? await admin.from('supplier_details').insert({ supplier_id: p.supplier.id, ...p.fill })
    : await admin.from('supplier_details').update(p.fill).eq('supplier_id', p.supplier.id);
  if (e) console.error(`  ${p.supplier.name}: ${e.message}`);
  else written++;
}
console.log(`\nWritten: ${written} suppliers.`);
