/**
 * Seed importer for `Actividades de logística_Master.xlsx`.
 *
 * Two phases, deliberately separated so seeding does not require the
 * workbook (which lives outside the repo):
 *
 *   npm run import:extract   xlsx  -> data/tasks.seed.json   (committed)
 *   npm run import:seed      json  -> Supabase               (idempotent)
 *
 * Idempotency: tasks are matched on (lower(title), frequency), backed by the
 * unique index `tasks_title_frequency_key`. Three activities legitimately
 * appear on two sheets at different cadences, so title alone is not a key.
 *
 * Scheduling: the workbook carries NO schedule data — its columns are
 * checkbox logging grids. Defaults defined in the requirements are applied;
 * where no default exists (the biweekly anchor date) the task is left
 * unconfigured and flagged for the admin rather than given an invented date.
 */
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { config as loadEnv } from 'dotenv';
import {
  DEFAULT_MONTHLY_RULE,
  DEFAULT_SEMIANNUAL_DATES,
  DEFAULT_WEEKLY_WEEKDAY,
  type Frequency,
  type ScheduleConfig,
} from '../src/domain/recurrence/types';

loadEnv({ path: '.env' });

const ROOT = resolve(__dirname, '..');
const SEED_PATH = resolve(ROOT, 'data', 'tasks.seed.json');

const DEFAULT_WORKBOOK =
  'C:/Users/MarianaGarcíaMASAMOR/Colectivo Anonimo/Colectivo Anonimo - _Oper/Bestandskontrolle/Logística/Actividades de logística_Master.xlsx';

/** Sheet name -> frequency. */
const SHEET_FREQUENCY: Record<string, Frequency> = {
  'Actividades Diarias': 'daily',
  'Actividades Semanales': 'weekly',
  'Actividades Quincenales': 'biweekly',
  'Actividades Mensuales': 'monthly',
  'Actividades Semestrales': 'semiannual',
};

/**
 * Category derived from the activity text. These are grouping labels for
 * reporting; frequency is a separate axis. Order matters — first match wins.
 */
const CATEGORY_RULES: { slug: string; name: string; sort: number; test: RegExp }[] = [
  { slug: 'inventario', name: 'Inventario', sort: 10, test: /\binventario\b/i },
  { slug: 'etiquetado', name: 'Etiquetado', sort: 20, test: /\betiquet/i },
  { slug: 'stock', name: 'Control de stock', sort: 30, test: /mantener un stock/i },
  { slug: 'limpieza', name: 'Limpieza y residuos', sort: 40, test: /limpieza|aspirar|mopear|basura|reciclaje|cart[óo]n\b.*aplastar|aplastar cart[óo]n|tirar pl[áa]stico|tanques de gas/i },
  { slug: 'almacen', name: 'Almacén y pedidos', sort: 50, test: /.*/ },
];

const HEADER_PATTERN = /^(Controlado por|Día del mes|KW|Actividades|Mes|Semana)/i;

export interface SeedTask {
  title: string;
  description: string | null;
  frequency: Frequency;
  category_slug: string;
  is_skippable: boolean;
  schedule_config: ScheduleConfig | null;
  /** Set when no schedule could be determined without guessing. */
  needs_admin_config: boolean;
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const v = cell.value as unknown;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((r) => r.text).join('');
    }
    if (typeof o.text === 'string') return o.text;
    if (o.result !== undefined) return String(o.result);
    return '';
  }
  return String(v);
}

function categoryFor(title: string) {
  return CATEGORY_RULES.find((r) => r.test.test(title)) ?? CATEGORY_RULES[CATEGORY_RULES.length - 1];
}

/** Apply only defaults the requirements actually define. */
function scheduleFor(frequency: Frequency): ScheduleConfig | null {
  switch (frequency) {
    case 'daily':
      // Weekends are not worked; a daily task means every working day.
      return { kind: 'daily', weekdays: [1, 2, 3, 4, 5] };
    case 'weekly':
      return { kind: 'weekly', weekday: DEFAULT_WEEKLY_WEEKDAY };
    case 'monthly':
      return { kind: 'monthly', rule: DEFAULT_MONTHLY_RULE };
    case 'semiannual':
      return { kind: 'semiannual', dates: DEFAULT_SEMIANNUAL_DATES };
    case 'biweekly':
      // No anchor date exists anywhere in the source. Never invent one.
      return null;
  }
}

async function extract(workbookPath: string): Promise<SeedTask[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(workbookPath);

  const tasks: SeedTask[] = [];
  const seen = new Set<string>();

  for (const [sheetName, frequency] of Object.entries(SHEET_FREQUENCY)) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) {
      console.warn(`  ! sheet not found: ${sheetName}`);
      continue;
    }

    let count = 0;
    for (let r = 1; r <= ws.rowCount; r++) {
      // Column B holds the activity name in every sheet.
      const title = cellText(ws.getRow(r).getCell(2)).trim().replace(/\s+/g, ' ');
      if (!title || HEADER_PATTERN.test(title)) continue;

      const key = `${title.toLowerCase()}::${frequency}`;
      if (seen.has(key)) continue; // guard against repeated rows within a sheet
      seen.add(key);

      const schedule = scheduleFor(frequency);
      tasks.push({
        title,
        description: null,
        frequency,
        category_slug: categoryFor(title).slug,
        // The workbook marks optional work in the title itself.
        is_skippable: /\(si es necesario\)/i.test(title),
        schedule_config: schedule,
        needs_admin_config: schedule === null,
      });
      count++;
    }
    console.log(`  ${sheetName.padEnd(26)} -> ${frequency.padEnd(11)} ${count} tasks`);
  }

  return tasks;
}

async function seed(tasks: SeedTask[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // ---- categories (idempotent on slug) ----
  const usedSlugs = new Set(tasks.map((t) => t.category_slug));
  const categoryRows = CATEGORY_RULES.filter((c) => usedSlugs.has(c.slug)).map((c) => ({
    slug: c.slug,
    name: c.name,
    sort_order: c.sort,
  }));

  const { error: catError } = await db
    .from('categories')
    .upsert(categoryRows, { onConflict: 'slug' });
  if (catError) throw new Error(`categories: ${catError.message}`);

  const { data: categories } = await db.from('categories').select('id, slug');
  const categoryId = new Map((categories ?? []).map((c) => [c.slug, c.id]));

  // ---- tasks ----
  // Read existing rows first so a re-run UPDATES rather than duplicating,
  // and so it never clobbers a schedule an admin has since configured.
  const { data: existing } = await db.from('tasks').select('id, title, frequency');
  const existingKey = new Map(
    (existing ?? []).map((t) => [`${t.title.trim().toLowerCase()}::${t.frequency}`, t.id]),
  );

  let inserted = 0;
  let skippedExisting = 0;

  const toInsert = tasks
    .filter((t) => {
      const hit = existingKey.has(`${t.title.toLowerCase()}::${t.frequency}`);
      if (hit) skippedExisting++;
      return !hit;
    })
    .map((t) => ({
      title: t.title,
      description: t.description,
      frequency: t.frequency,
      category_id: categoryId.get(t.category_slug) ?? null,
      is_skippable: t.is_skippable,
      is_active: true,
      schedule_config: t.schedule_config,
    }));

  if (toInsert.length > 0) {
    const { data, error } = await db.from('tasks').insert(toInsert).select('id');
    if (error) throw new Error(`tasks: ${error.message}`);
    inserted = data?.length ?? 0;
  }

  const needsConfig = tasks.filter((t) => t.needs_admin_config);

  console.log('');
  console.log(`  categories upserted : ${categoryRows.length}`);
  console.log(`  tasks inserted      : ${inserted}`);
  console.log(`  tasks already present: ${skippedExisting} (left untouched)`);
  console.log(`  needing admin config : ${needsConfig.length}`);
  for (const t of needsConfig) console.log(`     - [${t.frequency}] ${t.title}`);
}

async function main() {
  const mode = process.argv[2] ?? 'seed';

  if (mode === 'extract') {
    const path = process.argv[3] ?? process.env.SEED_WORKBOOK ?? DEFAULT_WORKBOOK;
    console.log(`Extracting from: ${path}\n`);
    const tasks = await extract(path);
    mkdirSync(dirname(SEED_PATH), { recursive: true });
    writeFileSync(SEED_PATH, JSON.stringify(tasks, null, 2) + '\n', 'utf8');
    console.log(`\n  ${tasks.length} tasks -> ${SEED_PATH}`);
    return;
  }

  console.log(`Seeding from: ${SEED_PATH}\n`);
  const tasks = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as SeedTask[];
  await seed(tasks);
}

main().catch((e) => {
  console.error(`\nERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
