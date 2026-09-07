/**
 * Inventory configuration import from Bestandkontrolle_Master.xlsx.
 *
 *   npm run inventory:extract   xlsx -> data/inventory.seed.json  (committed)
 *   npm run inventory:seed      json -> Supabase                  (idempotent)
 *
 * WHAT THIS IMPORTS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * The workbook's ten sheets are all BLANK TEMPLATES. Verified by inspection
 * before writing a line of this: there is not one literal quantity, expiry
 * date, KW or counter name anywhere in the file, and every Stock/Differenz
 * formula has a null cached result. The five "Masamor-Del Barrio KW" sheets
 * are byte-identical copies of each other; the two "Colectivo Comestibles KW"
 * sheets likewise; "Empaques_semestral" differs from "Empaques_mensual" only
 * by an instruction note in D1.
 *
 * So this script imports TEMPLATE CONFIGURATION AND ITEM LISTS ONLY. It
 * creates no inventory instances and no historical counts, because there is
 * no history in the source to create them from. Inventing completed counts
 * from a blank template would put fabricated numbers into a system whose
 * entire purpose is being auditable.
 *
 * Excel FORMULAS are not imported either. Stock is a trigger-maintained sum
 * and Difference is a generated column in Postgres; translating =D5-E5 into
 * application logic is the whole point of the migration.
 *
 * PRODUCT LINKING is by EXACT normalised name only. 57 of the 285 item names
 * match a product in the master exactly; the rest differ in wording, and
 * fuzzy-matching them would write wrong product_id links into an audit
 * record. The unmatched items are imported as independent inventory items
 * with product_id NULL, for an admin to link by hand where appropriate.
 */
import ExcelJS from 'exceljs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const ROOT = resolve(__dirname, '..');
const SEED_PATH = resolve(ROOT, 'data', 'inventory.seed.json');

const DEFAULT_SOURCE =
  'C:/Users/MarianaGarcíaMASAMOR/Colectivo Anonimo/Colectivo Anonimo - _Oper/Bestandskontrolle/Inventario/Bestandkontrolle_Master.xlsx';

/* ----------------------------- seed shapes ----------------------------- */

interface SeedItem {
  name: string;
  item_group: string | null;
  sort_order: number;
}

interface SeedTemplate {
  slug: string;
  name: string;
  kind: 'expiry' | 'lot' | 'location';
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'semiannual';
  schedule_config: unknown;
  digital_enabled: boolean;
  items: SeedItem[];
}

interface InventorySeed {
  source: string;
  extractedAt: string;
  templates: SeedTemplate[];
}

/* --------------------------- sheet definitions -------------------------- */

/**
 * How each template is read out of the workbook, and how it is configured.
 *
 * The schedules come from the operation, not from the file — the workbook
 * carries a cadence only as a note in one cell ("el último jueves de cada
 * mes"). Everything here is a starting configuration an admin can change in
 * the app; nothing about it is hard-coded anywhere else in the codebase.
 */
const SHEETS: (Omit<SeedTemplate, 'items'> & {
  sheet: string;
  nameCol: string;
  groupCol: string | null;
  firstRow: number;
  lastRow: number;
})[] = [
  {
    sheet: 'Masamor-Del Barrio KW',
    slug: 'masamor-del-barrio',
    name: 'Masamor / Del Barrio',
    kind: 'expiry',
    frequency: 'weekly',
    // Friday, chosen with the operation. The workbook says only "KW".
    schedule_config: { kind: 'weekly', weekday: 5 },
    digital_enabled: true,
    nameCol: 'C',
    groupCol: 'B',
    firstRow: 5,
    lastRow: 118,
  },
  {
    sheet: 'Colectivo Comestibles KW',
    slug: 'colectivo-comestibles',
    name: 'Colectivo Comestibles',
    kind: 'expiry',
    frequency: 'monthly',
    // Twice a month: the second Thursday and the last Thursday. This is the
    // case a single monthly rule cannot express.
    schedule_config: {
      kind: 'monthly',
      rules: [
        { type: 'nthWeekday', nth: 2, weekday: 4 },
        { type: 'nthWeekday', nth: -1, weekday: 4 },
      ],
    },
    digital_enabled: true,
    nameCol: 'C',
    groupCol: 'B',
    firstRow: 5,
    lastRow: 149,
  },
  {
    sheet: 'Materia prima_mensual',
    slug: 'materia-prima',
    name: 'Materia Prima',
    kind: 'lot',
    frequency: 'monthly',
    schedule_config: { kind: 'monthly', rules: [{ type: 'nthWeekday', nth: -1, weekday: 4 }] },
    // The sheet has no Bexio column, and raw materials are not reconciled
    // against a digital stock figure.
    digital_enabled: false,
    nameCol: 'B',
    groupCol: 'A',
    firstRow: 4,
    lastRow: 10,
  },
  {
    sheet: 'Empaques_mensual ', // the trailing space is in the workbook
    slug: 'empaques-mensual',
    name: 'Empaques (mensual)',
    kind: 'location',
    frequency: 'monthly',
    // D1 of the sheet: "el último jueves de cada mes".
    schedule_config: { kind: 'monthly', rules: [{ type: 'nthWeekday', nth: -1, weekday: 4 }] },
    digital_enabled: false,
    nameCol: 'B',
    groupCol: 'A',
    firstRow: 4,
    lastRow: 29,
  },
  {
    sheet: 'Empaques_semestral',
    slug: 'empaques-semestral',
    name: 'Empaques (semestral)',
    kind: 'location',
    frequency: 'semiannual',
    // 30 June and 31 December, pulled back to the preceding Friday by the
    // recurrence engine when they land at a weekend.
    schedule_config: {
      kind: 'semiannual',
      dates: [
        { month: 6, day: 30 },
        { month: 12, day: 31 },
      ],
    },
    digital_enabled: false,
    nameCol: 'B',
    groupCol: 'A',
    firstRow: 4,
    lastRow: 29,
  },
];

/* -------------------------------- helpers ------------------------------- */

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const v = cell.value as unknown;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if (typeof o.text === 'string') return o.text;
    return '';
  }
  return String(v);
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * Normalisation for EXACT product matching only.
 *
 * Collapses whitespace, unifies the several quote characters the workbook
 * uses, and drops trailing punctuation. Deliberately does NOT stem, drop
 * words, or compare by similarity: this is here to recognise the same string
 * typed slightly differently, not to guess that two different strings mean
 * the same product.
 */
const matchKey = (s: string) =>
  clean(s)
    .toLowerCase()
    .replace(/[\u201c\u201d\u2018\u2019`´]/g, '"')
    .replace(/[.,]/g, '');

/**
 * The group column is a merged cell, so only the FIRST row of each block
 * carries the value. Rows below inherit it, and a row outside every merge
 * (the workbook has a few) inherits the last group seen — which is what a
 * reader of the sheet would also conclude.
 */
function readItems(
  ws: ExcelJS.Worksheet,
  spec: (typeof SHEETS)[number],
): SeedItem[] {
  const items: SeedItem[] = [];
  let group: string | null = null;
  let order = 10;

  for (let row = spec.firstRow; row <= spec.lastRow; row++) {
    if (spec.groupCol) {
      const g = clean(cellText(ws.getCell(`${spec.groupCol}${row}`)));
      if (g) group = g;
    }
    const name = clean(cellText(ws.getCell(`${spec.nameCol}${row}`)));
    if (!name) continue;

    items.push({ name, item_group: group, sort_order: order });
    order += 10;
  }

  return items;
}

/* -------------------------------- extract ------------------------------- */

async function extract(sourcePath: string): Promise<InventorySeed> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);

  const templates: SeedTemplate[] = [];

  for (const spec of SHEETS) {
    const ws = wb.getWorksheet(spec.sheet);
    if (!ws) throw new Error(`Sheet not found: "${spec.sheet}"`);

    // Refuse to run against a workbook that is NOT blank. If somebody ever
    // fills a sheet in, this script must not quietly ignore their numbers —
    // importing history is a decision for a person, not a default.
    let literals = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === 'number' || cell.value instanceof Date) literals++;
      });
    });
    if (literals > 0) {
      throw new Error(
        `Sheet "${spec.sheet}" contains ${literals} literal value(s). This importer only ` +
          `reads blank templates. Counted data must not be imported without review.`,
      );
    }

    const items = readItems(ws, spec);
    const { sheet, nameCol, groupCol, firstRow, lastRow, ...template } = spec;
    templates.push({ ...template, items });
  }

  return {
    source: sourcePath,
    extractedAt: new Date().toISOString(),
    templates,
  };
}

/* --------------------------------- seed --------------------------------- */

interface Report {
  templatesCreated: number;
  templatesUpdated: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsDeactivated: number;
  productsLinked: number;
  productsUnlinked: number;
  errors: string[];
}

async function seed(db: SupabaseClient, data: InventorySeed, report: Report) {
  // The product master, keyed for exact-name matching. Only ACTIVE products:
  // linking an inventory item to a deactivated product would resurrect it in
  // a place nobody expects.
  const { data: products, error: productError } = await db
    .from('products')
    .select('id, name, code')
    .eq('is_active', true);

  if (productError) {
    report.errors.push(`load products: ${productError.message}`);
    return;
  }

  const byName = new Map<string, string>();
  for (const p of (products ?? []) as { id: string; name: string | null }[]) {
    if (!p.name) continue;
    const k = matchKey(p.name);
    // A key claimed by two products is ambiguous and is used for neither.
    if (byName.has(k)) byName.set(k, '');
    else byName.set(k, p.id);
  }

  for (const tpl of data.templates) {
    // ---- template ----
    const { data: existing } = await db
      .from('inventory_templates')
      .select('id')
      .eq('slug', tpl.slug)
      .maybeSingle();

    const payload = {
      slug: tpl.slug,
      name: tpl.name,
      kind: tpl.kind,
      frequency: tpl.frequency,
      schedule_config: tpl.schedule_config,
      digital_enabled: tpl.digital_enabled,
      is_active: true,
    };

    let templateId: string;
    if (existing) {
      templateId = (existing as { id: string }).id;
      // Re-running never resets an admin's later edits to the schedule or to
      // the Inventory Digital switch: only identity fields are refreshed.
      const { error } = await db
        .from('inventory_templates')
        .update({ name: tpl.name })
        .eq('id', templateId);
      if (error) {
        report.errors.push(`update template ${tpl.slug}: ${error.message}`);
        continue;
      }
      report.templatesUpdated++;
    } else {
      const { data: created, error } = await db
        .from('inventory_templates')
        .insert(payload)
        .select('id')
        .single();
      if (error || !created) {
        report.errors.push(`create template ${tpl.slug}: ${error?.message}`);
        continue;
      }
      templateId = (created as { id: string }).id;
      report.templatesCreated++;
    }

    // ---- items ----
    const { data: currentItems, error: itemError } = await db
      .from('inventory_template_items')
      .select('id, name, item_group, sort_order, product_id, is_active')
      .eq('template_id', templateId);

    if (itemError) {
      report.errors.push(`load items ${tpl.slug}: ${itemError.message}`);
      continue;
    }

    const existingByName = new Map(
      ((currentItems ?? []) as { id: string; name: string }[]).map((i) => [i.name, i]),
    );

    const toInsert: Record<string, unknown>[] = [];

    for (const item of tpl.items) {
      const productId = byName.get(matchKey(item.name)) || null;
      if (productId) report.productsLinked++;
      else report.productsUnlinked++;

      const hit = existingByName.get(item.name) as
        | { id: string; item_group: string | null; sort_order: number; product_id: string | null; is_active: boolean }
        | undefined;

      if (!hit) {
        toInsert.push({
          template_id: templateId,
          name: item.name,
          item_group: item.item_group,
          sort_order: item.sort_order,
          product_id: productId,
          is_active: true,
        });
        continue;
      }

      const patch: Record<string, unknown> = {};
      if (hit.item_group !== item.item_group) patch.item_group = item.item_group;
      if (hit.sort_order !== item.sort_order) patch.sort_order = item.sort_order;
      // An existing link is never overwritten: an admin may have set it by
      // hand, and this script's exact match is not more authoritative.
      if (hit.product_id === null && productId) patch.product_id = productId;
      if (!hit.is_active) patch.is_active = true;

      if (Object.keys(patch).length === 0) {
        report.itemsUnchanged++;
        continue;
      }

      const { error } = await db.from('inventory_template_items').update(patch).eq('id', hit.id);
      if (error) report.errors.push(`update item ${item.name}: ${error.message}`);
      else report.itemsUpdated++;
    }

    for (let i = 0; i < toInsert.length; i += 100) {
      const { data: inserted, error } = await db
        .from('inventory_template_items')
        .insert(toInsert.slice(i, i + 100))
        .select('id');
      if (error) report.errors.push(`insert items ${tpl.slug}: ${error.message}`);
      else report.itemsCreated += inserted?.length ?? 0;
    }

    // An item that has left the workbook is DEACTIVATED, never deleted: every
    // past inventory that counted it must stay readable.
    const sourceNames = new Set(tpl.items.map((i) => i.name));
    const stale = ((currentItems ?? []) as { id: string; name: string; is_active: boolean }[]).filter(
      (i) => i.is_active && !sourceNames.has(i.name),
    );
    if (stale.length) {
      const { error } = await db
        .from('inventory_template_items')
        .update({ is_active: false })
        .in('id', stale.map((i) => i.id));
      if (error) report.errors.push(`deactivate items ${tpl.slug}: ${error.message}`);
      else report.itemsDeactivated += stale.length;
    }
  }
}

/* --------------------------------- main --------------------------------- */

async function main() {
  const mode = process.argv[2] ?? 'seed';

  if (mode === 'extract') {
    const source = process.env.SEED_INVENTORY ?? DEFAULT_SOURCE;
    console.log(`Extracting: ${source}\n`);
    const data = await extract(source);
    mkdirSync(dirname(SEED_PATH), { recursive: true });
    writeFileSync(SEED_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
    for (const t of data.templates) {
      console.log(`  ${t.name.padEnd(24)} ${String(t.items.length).padStart(4)} items`);
    }
    console.log(`\n  -> ${SEED_PATH}`);
    console.log('  No inventory instances and no historical counts were produced:');
    console.log('  every sheet in the workbook is a blank template.');
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  }
  const db = createClient(url, svc, { auth: { persistSession: false } });

  const data = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as InventorySeed;
  console.log(`Seeding from: ${SEED_PATH}`);

  const report: Report = {
    templatesCreated: 0, templatesUpdated: 0,
    itemsCreated: 0, itemsUpdated: 0, itemsUnchanged: 0, itemsDeactivated: 0,
    productsLinked: 0, productsUnlinked: 0,
    errors: [],
  };

  await seed(db, data, report);

  console.log(`\n  templates created  : ${report.templatesCreated}`);
  console.log(`  templates updated  : ${report.templatesUpdated}`);
  console.log(`  items created      : ${report.itemsCreated}`);
  console.log(`  items updated      : ${report.itemsUpdated}`);
  console.log(`  items unchanged    : ${report.itemsUnchanged}`);
  console.log(`  items deactivated  : ${report.itemsDeactivated}`);
  console.log(`  linked to products : ${report.productsLinked}`);
  console.log(`  left unlinked      : ${report.productsUnlinked}  (admin links these by hand)`);
  console.log(`  errors             : ${report.errors.length}`);
  for (const e of report.errors) console.log(`     ! ${e}`);

  if (report.errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
