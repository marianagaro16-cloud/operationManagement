/**
 * Completes the app's customers from a bexio contacts export (.xlsx).
 *
 *   node scripts/import-bexio-contacts.mjs <export.xlsx>           dry run: what would change
 *   node scripts/import-bexio-contacts.mjs <export.xlsx> --apply   writes it
 *
 * Only customers already in the app are touched; bexio contacts that are not
 * customers here are ignored. A customer is found by the bexio number stored
 * on an earlier run, else by company name (+ addition), else by the addition.
 *
 * The app wins: a field already filled here is never overwritten. bexio's
 * address goes into the BILLING address; the delivery address (the van's
 * round) is only filled for customers that have none.
 */
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env', quiet: true });
const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/import-bexio-contacts.mjs <export.xlsx> [--apply]');
  process.exit(1);
}
const apply = flag === '--apply';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------- reading the export ----------

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
const contacts = [];
ws.eachRow((row, n) => {
  if (n === 1) return;
  const o = {};
  head.forEach((h, i) => (o[h] = cell(row.getCell(i + 1).value)));
  o._company = o['Company name'] ?? ([o['Last name'], o['First name']].filter(Boolean).join(' ') || null);
  contacts.push(o);
});

// ---------- matching ----------

const fold = (s) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ø/g, 'o').replace(/&/g, ' und ').replace(/[^a-z0-9]+/g, ' ').trim();
const LEGAL = /\b(ag|gmbh|sa|sarl|sagl|kg|klg|ltd|llc|inc|co)\b/g;
const core = (s) => fold(s).replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
const index = (key) => {
  const map = new Map();
  for (const c of contacts) {
    const k = key(c);
    if (k) (map.get(k) ?? map.set(k, []).get(k)).push(c);
  }
  return map;
};
const byNo = index((c) => c['Contact no.']);
const byFull = index((c) => (c._company ? `${core(c._company)}|${core(c['Company name addition'])}` : null));
const byCompany = index((c) => (c._company ? core(c._company) : null));
const byAddition = index((c) => (c['Company name addition'] ? core(c['Company name addition']) : null));

const filledCount = (c) => Object.entries(c).filter(([k, v]) => !k.startsWith('_') && v).length;

function find(customer, details) {
  if (details?.bexio_no) {
    const hit = byNo.get(String(details.bexio_no));
    if (hit) return { contact: hit[0], how: 'bexio no.' };
  }
  const tries = [
    ['name + addition', byFull.get(`${core(customer.company_name)}|${core(customer.company_name_addition)}`)],
    ['name', byCompany.get(core(customer.company_name))],
    ['addition', customer.company_name_addition ? byAddition.get(core(customer.company_name_addition)) : null],
    ['name as addition', byAddition.get(core(customer.company_name))],
  ];
  for (const [how, hits] of tries) {
    if (!hits?.length) continue;
    if (hits.length === 1) return { contact: hits[0], how };
    // Several: the one at the same postcode, else the most complete.
    const same = hits.filter((h) => customer.postal_code && h['Postcode'] === String(customer.postal_code));
    const pool = same.length ? same : hits;
    const best = [...pool].sort((a, b) => filledCount(b) - filledCount(a))[0];
    return { contact: best, how: `${how}, 1 of ${hits.length} (${hits.map((h) => h['Contact no.']).join('/')})` };
  }
  return null;
}

// ---------- shaping bexio's values ----------

const COUNTRY = {
  Switzerland: 'CH', Germany: 'DE', Denmark: 'DK', Slovakia: 'SK', France: 'FR', Italy: 'IT', Austria: 'AT',
  Liechtenstein: 'LI', Spain: 'ES', Netherlands: 'NL', Belgium: 'BE', Luxembourg: 'LU', Mexico: 'MX', Sweden: 'SE',
};
const LANGUAGE = { German: 'de', French: 'fr', Italian: 'it', English: 'en', Spanish: 'es' };

/** "794403765" → "0794403765"; "33767792610" → "+33767792610"; anything typed stays as typed. */
function phone(v) {
  if (!v) return null;
  if (/^\d{9}$/.test(v)) return `0${v}`;
  if (/^[1-9]\d{9,12}$/.test(v)) return `+${v}`;
  return v;
}

/** The street line for the delivery address: street + number, else the last line of the address block. */
function streetLine(c) {
  if (c['Street']) return [c['Street'], c['House no.']].filter(Boolean).join(' ').trim();
  const lines = (c['Address'] ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.at(-1) ?? null;
}

// ---------- what changes ----------

const { data: customers, error } = await admin
  .from('customers')
  .select('id, company_name, company_name_addition, street, postal_code, city, country, website');
if (error) throw error;
const { data: existingDetails } = await admin.from('customer_details').select('*');
const detailsOf = new Map((existingDetails ?? []).map((d) => [d.customer_id, d]));

const plan = [];
const unmatched = [];
for (const customer of customers) {
  const current = detailsOf.get(customer.id) ?? null;
  const found = find(customer, current);
  if (!found) {
    unmatched.push(customer);
    continue;
  }
  const c = found.contact;
  const bexio = {
    bexio_no: Number(c['Contact no.']),
    email: c['Email'],
    email2: c['Email 2'],
    phone: phone(c['Phone']),
    phone2: phone(c['Phone 2']),
    mobile: phone(c['Mobile']),
    language: LANGUAGE[c['Language']] ?? null,
    billing_address: c['Address'],
    billing_postal_code: c['Postcode'],
    billing_city: c['City'],
    billing_country: COUNTRY[c['Country']] ?? null,
    vat_no: c['VAT no.'],
    uid_no: c['VAT identification number'],
    bexio_remarks: c['Remarks'],
  };
  // The app wins: only what is empty here.
  const details = {};
  for (const [k, v] of Object.entries(bexio)) if (v != null && (current?.[k] == null || current[k] === '')) details[k] = v;

  const own = {};
  if (!customer.website && c['Website']) own.website = c['Website'];
  // A delivery address only where there is none at all.
  if (!customer.street && !customer.city && (c['City'] || c['Address'])) {
    own.street = streetLine(c);
    own.postal_code = c['Postcode'];
    own.city = c['City'];
    if (COUNTRY[c['Country']]) own.country = COUNTRY[c['Country']];
  }
  plan.push({ customer, how: found.how, contact: c, details, own, isNew: !current });
}

// One bexio contact behind several customers here (a company with two
// restaurants): its number cannot name both, and its address is the
// company's, not each restaurant's door.
const uses = new Map();
for (const p of plan) uses.set(p.contact['Contact no.'], (uses.get(p.contact['Contact no.']) ?? 0) + 1);
for (const p of plan) {
  if (uses.get(p.contact['Contact no.']) < 2) continue;
  delete p.details.bexio_no;
  for (const k of ['street', 'postal_code', 'city', 'country']) delete p.own[k];
  p.shared = true;
}

const label = (cu) => `${cu.company_name}${cu.company_name_addition ? ` / ${cu.company_name_addition}` : ''}`;
console.log(`${customers.length} customers in the app · ${plan.length} found in bexio · ${unmatched.length} not found\n`);
const loose = plan.filter((p) => p.how !== 'name + addition' && p.how !== 'name' && p.how !== 'bexio no.');
if (loose.length) {
  console.log('Matched less directly (check):');
  for (const p of loose) console.log(`  ${label(p.customer)}  <-  bexio ${p.contact['Contact no.']} ${p.contact._company} / ${p.contact['Company name addition'] ?? ''}  [${p.how}]`);
  console.log('');
}
const addresses = plan.filter((p) => p.own.street !== undefined);
const shared = plan.filter((p) => p.shared);
if (shared.length) {
  console.log('Sharing one bexio contact (contact data filled, delivery address and bexio no. left alone):');
  for (const p of shared) console.log(`  ${label(p.customer)}  <-  bexio ${p.contact['Contact no.']}`);
  console.log('');
}
console.log(`Delivery address filled (had none): ${addresses.length}`);
for (const p of addresses) console.log(`  ${label(p.customer)}: ${p.own.street}, ${p.own.postal_code ?? ''} ${p.own.city ?? ''}`);
const count = (k) => plan.filter((p) => p.details[k] != null).length;
console.log(`\nFields filled: email ${count('email')}, email 2 ${count('email2')}, phone ${count('phone')}, phone 2 ${count('phone2')}, mobile ${count('mobile')}, language ${count('language')}, billing address ${count('billing_address')}, VAT ${count('vat_no')}, UID ${count('uid_no')}, remarks ${count('bexio_remarks')}, website ${plan.filter((p) => p.own.website).length}`);
console.log(`\nNot found in bexio (left as they are):`);
for (const cu of unmatched) console.log(`  ${label(cu)}`);

if (!apply) {
  console.log('\nDry run. Add --apply to write.');
  process.exit(0);
}

let written = 0;
for (const p of plan) {
  if (Object.keys(p.details).length) {
    const { error: e } = p.isNew
      ? await admin.from('customer_details').insert({ customer_id: p.customer.id, ...p.details })
      : await admin.from('customer_details').update(p.details).eq('customer_id', p.customer.id);
    if (e) {
      console.error(`  ${label(p.customer)}: ${e.message}`);
      continue;
    }
  }
  if (Object.keys(p.own).length) {
    const { error: e } = await admin.from('customers').update(p.own).eq('id', p.customer.id);
    if (e) {
      console.error(`  ${label(p.customer)} (address/website): ${e.message}`);
      continue;
    }
  }
  written++;
}
console.log(`\nWritten: ${written} customers.`);
