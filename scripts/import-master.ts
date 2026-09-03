/**
 * Master data import for customers and products.
 *
 *   npm run master:extract   xlsx -> data/master.seed.json  (committed)
 *   npm run master:seed      json -> Supabase               (idempotent)
 *   npm run master:seed -- --reset-customers                (one-time clean slate)
 *
 * Sources:
 *   contacts_clients.xlsx   Company name + Company name addition   (216)
 *   productos.xlsx          Product code + Product name            (261)
 *
 * Rules:
 *  - Product code is the business identifier. Matching is by code only;
 *    names are never used to match, and are never parsed into structured
 *    fields.
 *  - Customer identity is the (company name, addition) pair.
 *  - Records absent from the source are DEACTIVATED, never deleted, so
 *    historical orders keep resolving.
 *  - Re-running changes nothing that is already correct.
 */
import ExcelJS from 'exceljs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const ROOT = resolve(__dirname, '..');
const SEED_PATH = resolve(ROOT, 'data', 'master.seed.json');

const BASE = 'C:/Users/MarianaGarcíaMASAMOR/Colectivo Anonimo/Colectivo Anonimo - _Admin/Mariana/VSC';
const DEFAULT_CLIENTS = `${BASE}/contacts_clients.xlsx`;
const DEFAULT_PRODUCTS = `${BASE}/productos.xlsx`;

interface SeedCustomer { company_name: string; company_name_addition: string | null }
interface SeedProduct { code: string; name: string }
interface MasterSeed { customers: SeedCustomer[]; products: SeedProduct[] }

interface Report {
  source: number;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  reactivated: number;
  review: string[];
  errors: string[];
}

const emptyReport = (): Report => ({
  source: 0, created: 0, updated: 0, unchanged: 0,
  deactivated: 0, reactivated: 0, review: [], errors: [],
});

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const v = cell.value as unknown;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if (typeof o.text === 'string') return o.text;
    if (o.result !== undefined) return String(o.result);
    return '';
  }
  return String(v);
}
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const key = (s: string) => clean(s).toLowerCase();

async function readTwoColumns(file: string): Promise<[string, string][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const rows: [string, string][] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const a = clean(cellText(ws.getRow(r).getCell(1)));
    const b = clean(cellText(ws.getRow(r).getCell(2)));
    if (a || b) rows.push([a, b]);
  }
  return rows;
}

/* ------------------------------- extract ------------------------------- */

async function extract(clientsPath: string, productsPath: string): Promise<MasterSeed> {
  const customerRows = await readTwoColumns(clientsPath);
  const productRows = await readTwoColumns(productsPath);

  const customers: SeedCustomer[] = [];
  const seenCustomer = new Set<string>();
  for (const [company_name, addition] of customerRows) {
    if (!company_name) continue; // a customer without a company name is not identifiable
    const k = `${key(company_name)}|${key(addition)}`;
    if (seenCustomer.has(k)) continue;
    seenCustomer.add(k);
    customers.push({ company_name, company_name_addition: addition || null });
  }

  const products: SeedProduct[] = [];
  const seenCode = new Set<string>();
  for (const [code, name] of productRows) {
    if (!code || !name) continue;
    if (seenCode.has(code)) continue; // codes are unique in the source; guard anyway
    seenCode.add(code);
    products.push({ code, name });
  }

  console.log(`  customers: ${customers.length} (from ${customerRows.length} rows)`);
  console.log(`  products : ${products.length} (from ${productRows.length} rows)`);
  return { customers, products };
}

/* -------------------------------- seed --------------------------------- */

interface DbCustomer {
  id: string; company_name: string; company_name_addition: string | null; is_active: boolean;
}
interface DbProduct {
  id: string; code: string | null; name: string | null; is_active: boolean; needs_review: boolean;
}

/**
 * One-time clean slate. Only ever runs behind --reset-customers, and refuses
 * to touch anything that a non-cancelled order depends on.
 */
async function resetCustomers(db: SupabaseClient, report: Report) {
  const { data: orders } = await db.from('orders').select('id, reference, status, customer_id');
  const live = (orders ?? []).filter((o) => o.status !== 'cancelled');
  if (live.length > 0) {
    report.errors.push(
      `--reset-customers refused: ${live.length} non-cancelled orders exist ` +
      `(#${live.map((o) => o.reference).join(', #')}). Deleting their customers would destroy real history.`,
    );
    return false;
  }

  // Templates first: they reference customers and are inactive seed data.
  const { data: tpls } = await db.from('recurring_order_templates').select('id');
  if (tpls?.length) {
    await db.from('recurring_order_templates').delete().in('id', tpls.map((t) => t.id));
    console.log(`  removed ${tpls.length} seeded recurring templates`);
  }
  // Then the cancelled test orders (order_lines and allocations cascade).
  if (orders?.length) {
    await db.from('orders').delete().in('id', orders.map((o) => o.id));
    console.log(`  removed ${orders.length} cancelled test orders`);
  }
  const { data: existing } = await db.from('customers').select('id');
  if (existing?.length) {
    const { error } = await db.from('customers').delete().in('id', existing.map((c) => c.id));
    if (error) { report.errors.push(`customer reset: ${error.message}`); return false; }
    console.log(`  removed ${existing.length} legacy customers`);
  }
  return true;
}

async function seedCustomers(
  db: SupabaseClient,
  source: SeedCustomer[],
  report: Report,
): Promise<void> {
  report.source = source.length;

  const { data: existingRaw, error } = await db
    .from('customers')
    .select('id, company_name, company_name_addition, is_active');
  if (error) { report.errors.push(`read customers: ${error.message}`); return; }
  const existing = (existingRaw ?? []) as DbCustomer[];

  const identity = (c: { company_name: string; company_name_addition: string | null }) =>
    `${key(c.company_name)}|${key(c.company_name_addition ?? '')}`;

  const byIdentity = new Map(existing.map((c) => [identity(c), c]));
  const sourceIdentities = new Set(source.map(identity));

  const toInsert: SeedCustomer[] = [];
  for (const s of source) {
    const hit = byIdentity.get(identity(s));
    if (!hit) { toInsert.push(s); continue; }
    if (!hit.is_active) {
      const { error } = await db.from('customers').update({ is_active: true }).eq('id', hit.id);
      if (error) report.errors.push(`reactivate ${s.company_name}: ${error.message}`);
      else report.reactivated++;
    } else {
      report.unchanged++;
    }
  }

  if (toInsert.length) {
    // Chunked so one oversized request cannot fail the whole run.
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100).map((c) => ({
        company_name: c.company_name,
        company_name_addition: c.company_name_addition,
        is_active: true,
      }));
      const { data, error } = await db.from('customers').insert(chunk).select('id');
      if (error) report.errors.push(`insert customers: ${error.message}`);
      else report.created += data?.length ?? 0;
    }
  }

  // Absent from the source -> inactive, never deleted.
  const stale = existing.filter((c) => c.is_active && !sourceIdentities.has(identity(c)));
  if (stale.length) {
    const { error } = await db
      .from('customers').update({ is_active: false }).in('id', stale.map((c) => c.id));
    if (error) report.errors.push(`deactivate customers: ${error.message}`);
    else report.deactivated = stale.length;
    for (const c of stale.slice(0, 25)) {
      report.review.push(`deactivated: ${c.company_name}${c.company_name_addition ? ' / ' + c.company_name_addition : ''}`);
    }
  }
}

async function seedProducts(
  db: SupabaseClient,
  source: SeedProduct[],
  report: Report,
): Promise<void> {
  report.source = source.length;

  const { data: existingRaw, error } = await db
    .from('products').select('id, code, name, is_active, needs_review');
  if (error) { report.errors.push(`read products: ${error.message}`); return; }
  const existing = (existingRaw ?? []) as DbProduct[];

  // Match on code ONLY. Names are never used to match and never parsed.
  // Where a code was duplicated, the migration left exactly one active row;
  // prefer it so the unique index is never violated.
  const byCode = new Map<string, DbProduct>();
  for (const p of existing) {
    if (!p.code) continue;
    const prev = byCode.get(p.code);
    if (!prev || (!prev.is_active && p.is_active)) byCode.set(p.code, p);
  }

  const sourceCodes = new Set(source.map((p) => p.code));
  const toInsert: SeedProduct[] = [];

  for (const s of source) {
    const hit = byCode.get(s.code);
    if (!hit) { toInsert.push(s); continue; }

    const patch: Record<string, unknown> = {};
    if (hit.name !== s.name) patch.name = s.name;      // source of truth
    if (!hit.is_active) patch.is_active = true;

    if (Object.keys(patch).length === 0) { report.unchanged++; continue; }

    const { error } = await db.from('products').update(patch).eq('id', hit.id);
    if (error) { report.errors.push(`update ${s.code}: ${error.message}`); continue; }
    if (patch.is_active) report.reactivated++;
    if (patch.name !== undefined) report.updated++;
  }

  if (toInsert.length) {
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100).map((p) => ({
        code: p.code,
        name: p.name,
        // Structured fields stay empty: nothing is inferred from the name.
        family: p.name,        // family is NOT NULL; mirrors the name until
        presentation: '—',     // real structured data is supplied.
        category: null,
        is_active: true,
        needs_review: false,
      }));
      const { data, error } = await db.from('products').insert(chunk).select('id');
      if (error) report.errors.push(`insert products: ${error.message}`);
      else report.created += data?.length ?? 0;
    }
  }

  // Absent from the source -> inactive, never deleted.
  const stale = existing.filter((p) => p.is_active && (!p.code || !sourceCodes.has(p.code)));
  if (stale.length) {
    const { error } = await db
      .from('products').update({ is_active: false }).in('id', stale.map((p) => p.id));
    if (error) report.errors.push(`deactivate products: ${error.message}`);
    else report.deactivated = stale.length;
    for (const p of stale.slice(0, 25)) {
      report.review.push(`deactivated: [${p.code ?? 'no code'}] ${p.name ?? '(legacy)'}`);
    }
  }
}

function printReport(label: string, r: Report) {
  console.log(`\n  ${label}`);
  console.log(`    source records   : ${r.source}`);
  console.log(`    created          : ${r.created}`);
  console.log(`    updated          : ${r.updated}`);
  console.log(`    already matching : ${r.unchanged}`);
  console.log(`    reactivated      : ${r.reactivated}`);
  console.log(`    deactivated      : ${r.deactivated}`);
  console.log(`    errors           : ${r.errors.length}`);
  for (const e of r.errors) console.log(`       ! ${e}`);
  if (r.review.length) {
    console.log(`    manual review    : ${r.review.length} (showing up to 25)`);
    for (const m of r.review.slice(0, 25)) console.log(`       - ${m}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] ?? 'seed';

  if (mode === 'extract') {
    const clients = process.env.SEED_CLIENTS ?? DEFAULT_CLIENTS;
    const products = process.env.SEED_PRODUCTS ?? DEFAULT_PRODUCTS;
    console.log(`Extracting:\n  ${clients}\n  ${products}\n`);
    const seed = await extract(clients, products);
    mkdirSync(dirname(SEED_PATH), { recursive: true });
    writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n', 'utf8');
    console.log(`  -> ${SEED_PATH}`);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  const db = createClient(url, svc, { auth: { persistSession: false } });

  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as MasterSeed;
  console.log(`Seeding from: ${SEED_PATH}`);

  const customerReport = emptyReport();
  const productReport = emptyReport();

  if (args.includes('--reset-customers')) {
    console.log('\n  --reset-customers: removing legacy customer data');
    const ok = await resetCustomers(db, customerReport);
    if (!ok) { printReport('CUSTOMERS', customerReport); process.exit(1); }
  }

  await seedCustomers(db, seed.customers, customerReport);
  await seedProducts(db, seed.products, productReport);

  printReport('CUSTOMERS', customerReport);
  printReport('PRODUCTS', productReport);

  const failed = customerReport.errors.length + productReport.errors.length;
  console.log(`\n  ${failed === 0 ? 'completed with no errors' : failed + ' error(s) — see above'}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
