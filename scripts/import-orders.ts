/**
 * Seed importer for the Orders module master data.
 *
 *   npm run orders:extract   xlsx -> data/orders.seed.json  (committed)
 *   npm run orders:seed      json -> Supabase               (idempotent)
 *
 * Sources:
 *   Control de pedidos-Master.xlsx        product variants + weekday roster
 *   Lotnummerkontrol_Master_para_copiar.xlsx   customer list (Datos sheet)
 *
 * Only MASTER data is imported. Historical orders stay in Excel; the app is
 * the system of record from the go-live date onward.
 */
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const ROOT = resolve(__dirname, '..');
const SEED_PATH = resolve(ROOT, 'data', 'orders.seed.json');

const BASE = 'C:/Users/MarianaGarcíaMASAMOR/Colectivo Anonimo/Colectivo Anonimo - _Oper';
const DEFAULT_PEDIDOS = `${BASE}/Control de pedidos, muestras y reposiciones/Masamor/Control de pedidos-Master.xlsx`;
const DEFAULT_LOTNUMMER = `${BASE}/Lotnummer Kontrol/Lotnummerkontrol_Master_para_copiar.xlsx`;

/**
 * Delivery methods from the spreadsheet legend.
 *
 * "Muestras" and "Cancelado" are deliberately NOT here: a sample is an order
 * TYPE (it can still ship by DHL) and cancelled is an order STATUS.
 */
const DELIVERY_METHODS = [
  { slug: 'planzer', name: 'Envío refrigerado o pallet (Planzer)', sort_order: 10 },
  { slug: 'dhl', name: 'Envío por DHL', sort_order: 20 },
  { slug: 'zurich', name: 'Entrega en Zürich', sort_order: 30 },
  { slug: 'carlos', name: 'Entrega con Carlos', sort_order: 40 },
  { slug: 'fabrica', name: 'Se recoge en la fábrica', sort_order: 50 },
];

const WEEKDAYS: Record<string, number> = {
  LUNES: 1, MARTES: 2, 'MIÉRCOLES': 3, MIERCOLES: 3, JUEVES: 4, VIERNES: 5,
};

/** Column-A rows that are reminders or legend entries, not customers. */
const NOT_A_CUSTOMER =
  /^(notas|pedir transporte|env[íi]o|entrega|se recoge|muestras|cancelado|clientes con pago)/i;

export interface SeedProduct {
  code: string | null;
  family: string;
  presentation: string;
  needs_review: boolean;
  review_reason: string | null;
}
export interface SeedTemplate {
  customer: string;
  delivery_weekday: number;
}
export interface OrdersSeed {
  customers: string[];
  products: SeedProduct[];
  delivery_methods: typeof DELIVERY_METHODS;
  recurring_templates: SeedTemplate[];
}

function txt(cell: ExcelJS.Cell | undefined): string {
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

async function extract(pedidosPath: string, lotPath: string): Promise<OrdersSeed> {
  // ---------- products (Control de pedidos: row 5 family, 6 presentation, 7 code) ----------
  const ped = new ExcelJS.Workbook();
  await ped.xlsx.readFile(pedidosPath);
  const ws = ped.worksheets[0];
  const rFamily = ws.getRow(5), rPres = ws.getRow(6), rCode = ws.getRow(7);

  const raw: { family: string; presentation: string; code: string }[] = [];
  for (let c = 2; c <= 261; c++) {
    const family = clean(txt(rFamily.getCell(c)));
    const presentation = clean(txt(rPres.getCell(c)));
    const code = clean(txt(rCode.getCell(c)));
    if (!family || !presentation) continue; // a variant needs both to be sellable
    raw.push({ family, presentation, code });
  }

  // Flag rather than silently resolve: codes are reused and some are missing.
  const codeCounts = new Map<string, number>();
  for (const r of raw) if (r.code) codeCounts.set(r.code, (codeCounts.get(r.code) ?? 0) + 1);
  const pairCounts = new Map<string, number>();
  for (const r of raw) {
    const k = `${r.family.toLowerCase()}|${r.presentation.toLowerCase()}`;
    pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const products: SeedProduct[] = [];
  for (const r of raw) {
    // Identity is (code, family, presentation): the same family+presentation
    // legitimately appears twice under different codes (yellow vs blue), so
    // the code participates in de-duplication.
    const key = `${r.code}|${r.family.toLowerCase()}|${r.presentation.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const reasons: string[] = [];
    if (!r.code) reasons.push('missing product code');
    if (r.code && (codeCounts.get(r.code) ?? 0) > 1) reasons.push(`code ${r.code} reused`);
    if ((pairCounts.get(`${r.family.toLowerCase()}|${r.presentation.toLowerCase()}`) ?? 0) > 1) {
      reasons.push('duplicate family + presentation');
    }

    products.push({
      code: r.code || null,
      family: r.family,
      presentation: r.presentation,
      needs_review: reasons.length > 0,
      review_reason: reasons.length ? reasons.join('; ') : null,
    });
  }

  // ---------- weekday roster -> recurring templates ----------
  const templates: SeedTemplate[] = [];
  const rosterNames = new Set<string>();
  let weekday = 0;
  for (let r = 8; r <= 40; r++) {
    const a = clean(txt(ws.getRow(r).getCell(1)));
    if (!a) continue;
    const upper = a.toUpperCase();
    if (WEEKDAYS[upper]) { weekday = WEEKDAYS[upper]; continue; }
    if (upper === 'NOTAS:' ) break;
    if (NOT_A_CUSTOMER.test(a)) continue;
    if (!weekday) continue;
    templates.push({ customer: a, delivery_weekday: weekday });
    rosterNames.add(a);
  }

  // ---------- customers (Datos column F) ----------
  const lot = new ExcelJS.Workbook();
  await lot.xlsx.readFile(lotPath);
  const datos = lot.getWorksheet('Datos');
  const names: string[] = [];
  const dedupe = new Set<string>();
  const add = (n: string) => {
    const v = clean(n);
    if (!v) return;
    const k = v.toLowerCase();
    if (dedupe.has(k)) return;
    dedupe.add(k);
    names.push(v);
  };
  if (datos) for (let r = 1; r <= datos.rowCount; r++) add(txt(datos.getRow(r).getCell(6)));
  // The weekly roster uses short names that are not always in Datos.
  for (const n of rosterNames) add(n);

  return {
    customers: names,
    products,
    delivery_methods: DELIVERY_METHODS,
    recurring_templates: templates,
  };
}

async function seed(data: OrdersSeed) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  const db = createClient(url, key, { auth: { persistSession: false } });

  // ---- delivery methods (idempotent on slug) ----
  const { error: dmErr } = await db
    .from('delivery_methods')
    .upsert(data.delivery_methods, { onConflict: 'slug' });
  if (dmErr) throw new Error(`delivery_methods: ${dmErr.message}`);

  // ---- customers (idempotent on lower(name)) ----
  const { data: existingCustomers } = await db.from('customers').select('id, name');
  const customerByName = new Map(
    (existingCustomers ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  const newCustomers = data.customers.filter((n) => !customerByName.has(n.toLowerCase()));
  if (newCustomers.length) {
    const { error } = await db.from('customers').insert(newCustomers.map((name) => ({ name })));
    if (error) throw new Error(`customers: ${error.message}`);
  }

  // ---- products (idempotent on code+family+presentation) ----
  const { data: existingProducts } = await db.from('products').select('id, code, family, presentation');
  const productKey = (p: { code: string | null; family: string; presentation: string }) =>
    `${p.code ?? ''}|${p.family.trim().toLowerCase()}|${p.presentation.trim().toLowerCase()}`;
  const existingProductKeys = new Set((existingProducts ?? []).map(productKey));
  const newProducts = data.products.filter((p) => !existingProductKeys.has(productKey(p)));
  if (newProducts.length) {
    const { error } = await db.from('products').insert(
      newProducts.map((p) => ({
        code: p.code,
        family: p.family,
        presentation: p.presentation,
        needs_review: p.needs_review,
        notes: p.review_reason,
        is_active: true,
      })),
    );
    if (error) throw new Error(`products: ${error.message}`);
  }

  // ---- recurring templates, INACTIVE pending admin review ----
  const { data: allCustomers } = await db.from('customers').select('id, name');
  const byName = new Map((allCustomers ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));
  const { data: existingTpl } = await db
    .from('recurring_order_templates')
    .select('customer_id, delivery_weekday');
  const tplKeys = new Set((existingTpl ?? []).map((t) => `${t.customer_id}|${t.delivery_weekday}`));

  const newTemplates = [];
  const unmatched: string[] = [];
  for (const t of data.recurring_templates) {
    const customerId = byName.get(t.customer.toLowerCase());
    if (!customerId) { unmatched.push(t.customer); continue; }
    const k = `${customerId}|${t.delivery_weekday}`;
    if (tplKeys.has(k)) continue;
    tplKeys.add(k);
    newTemplates.push({
      customer_id: customerId,
      delivery_weekday: t.delivery_weekday,
      name: `${t.customer} — weekday ${t.delivery_weekday}`,
      // Inactive on purpose: the weekday roster is evidence of a pattern, not
      // proof that the order genuinely recurs. An admin activates it.
      is_active: false,
    });
  }
  if (newTemplates.length) {
    const { error } = await db.from('recurring_order_templates').insert(newTemplates);
    if (error) throw new Error(`templates: ${error.message}`);
  }

  const needsReview = data.products.filter((p) => p.needs_review);
  console.log('');
  console.log(`  delivery methods : ${data.delivery_methods.length} upserted`);
  console.log(`  customers        : ${newCustomers.length} new (${data.customers.length} in source)`);
  console.log(`  products         : ${newProducts.length} new (${data.products.length} in source)`);
  console.log(`  templates        : ${newTemplates.length} new, all INACTIVE`);
  if (unmatched.length) console.log(`  unmatched roster : ${[...new Set(unmatched)].join(', ')}`);
  console.log(`  products flagged for admin review: ${needsReview.length}`);
  for (const p of needsReview.slice(0, 20)) {
    console.log(`     [${p.code ?? '----'}] ${p.family} / ${p.presentation}  (${p.review_reason})`);
  }
  if (needsReview.length > 20) console.log(`     ...and ${needsReview.length - 20} more`);
}

async function main() {
  const mode = process.argv[2] ?? 'seed';
  if (mode === 'extract') {
    const pedidos = process.argv[3] ?? process.env.SEED_PEDIDOS ?? DEFAULT_PEDIDOS;
    const lotnummer = process.argv[4] ?? process.env.SEED_LOTNUMMER ?? DEFAULT_LOTNUMMER;
    console.log(`Extracting:\n  ${pedidos}\n  ${lotnummer}\n`);
    const data = await extract(pedidos, lotnummer);
    mkdirSync(dirname(SEED_PATH), { recursive: true });
    writeFileSync(SEED_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`  customers=${data.customers.length} products=${data.products.length} ` +
      `methods=${data.delivery_methods.length} templates=${data.recurring_templates.length}`);
    console.log(`  -> ${SEED_PATH}`);
    return;
  }
  console.log(`Seeding from: ${SEED_PATH}\n`);
  await seed(JSON.parse(readFileSync(SEED_PATH, 'utf8')) as OrdersSeed);
}

main().catch((e) => {
  console.error(`\nERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
