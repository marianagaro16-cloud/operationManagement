/**
 * Brings the work schedule over from Master_Arbeitsplanmasamor.xlsx (2026-10-09).
 *
 *   node scripts/import-schedule.mjs "<path to the workbook>" [--weeks=YYYY-MM-DD,…] [--dry]
 *
 * Three things, each safe to run again:
 *  - the people on the schedule, with what the "Notas" sheet says about them;
 *  - the weekly sheets ("Semana 01" …) that hold a week not yet in the app,
 *    as published version 1;
 *  - the Sunday and holiday register of 2025 and 2026 — what is past as
 *    imported, what is still ahead as planned.
 *
 * Runs as the service role: it writes for the system, not for a user.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import ExcelJS from 'exceljs';

config({ path: '.env', quiet: true });
const file = process.argv[2];
const dry = process.argv.includes('--dry');
// --weeks=2026-10-04,2026-10-11 : only these weekly sheets; without it, every one.
const only = (process.argv.find((a) => a.startsWith('--weeks='))?.slice(8) ?? '').split(',').filter(Boolean);
if (!file) {
  console.error('usage: node scripts/import-schedule.mjs "<workbook.xlsx>" [--dry]');
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());

/* ------------------------------- the people ------------------------------- */

// label on the sheet → how to find the worker file, and what "Notas" says.
const PEOPLE = [
  { label: 'Freddy', file: 'Freddy', percent: 100, lead: true, sunday: 3 },
  { label: 'Rafael', file: 'Rafael', percent: 100, sunday: 4, aliases: ['Rafa'] },
  { label: 'Patty', file: 'Patricia', percent: 70, min: 31, sunday: 1 },
  { label: 'Marco', file: 'Marco', percent: 100, lead: true, sunday: 8, aliases: ['Marcos'] },
  { label: 'Jefferson', file: 'Jefferson', percent: 100, sunday: 5 },
  { label: 'Bruce', file: 'Bruce', percent: 60, sunday: 6 },
  { label: 'Gabriel', file: 'Gabriel', percent: 80, sunday: 7 },
  { label: 'Jorge', external: true, sunday: 2 },
  { label: 'Joselyne', external: true, aliases: ['Joselyn'] },
  { label: 'Coople', external: true },
];

async function importPeople() {
  const workers = must(await db.from('hr_workers').select('id, name').eq('is_active', true));
  const existing = must(await db.from('schedule_people').select('id, worker_id, external_name, label'));
  const byLabel = new Map();
  for (const [i, p] of PEOPLE.entries()) {
    const worker = p.external ? null : workers.find((w) => w.name.split(' ')[0] === p.file);
    if (!p.external && !worker) throw new Error(`no worker file for ${p.label}`);
    let row = existing.find((e) => (worker ? e.worker_id === worker.id : e.external_name === p.label));
    if (!row) {
      const values = {
        worker_id: worker?.id ?? null,
        external_name: worker ? null : p.label,
        label: p.label,
        sort_order: (i + 1) * 10,
        percent: p.percent ?? null,
        min_hours: p.min ?? null,
        is_lead: !!p.lead,
        in_sunday_rotation: !!p.sunday,
        sunday_order: p.sunday ?? 0,
      };
      row = dry ? { id: `dry-${p.label}` } : must(await db.from('schedule_people').insert(values).select('id').single());
      console.log(`  person  + ${p.label}${worker ? ` (${worker.name})` : ' (external)'}`);
    }
    for (const name of [p.label, ...(p.aliases ?? [])]) byLabel.set(name.toLowerCase(), row.id);
  }
  return byLabel;
}

/* -------------------------------- a week -------------------------------- */

const hm = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && !(v instanceof Date)) v = v.result ?? null;
  if (v instanceof Date) return v.toISOString().slice(11, 16);
  if (typeof v === 'number' && v > 0 && v < 1) {
    const m = Math.round(v * 1440);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  return null;
};
const text = (cell) => {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && v.richText) return v.richText.map((r) => r.text).join('').trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  return String(v).trim();
};

/** The kind a cell's fill stands for; null = production, undefined = just "changed" yellow. */
function kindName(cell) {
  const f = cell.fill;
  if (!f || f.type !== 'pattern' || f.pattern === 'none') return null;
  if (f.pattern === 'darkTrellis') return 'Vacaciones';
  if (f.pattern === 'darkDown') return 'Libre';
  if (f.pattern === 'darkGray') return 'Enfermedad';
  const argb = f.fgColor?.argb;
  const theme = f.fgColor?.theme;
  if (argb === 'FFFF91ED') return 'Oficina';
  if (argb === 'FF84E8E8') return 'Limpieza';
  if (argb === 'FF9EF830') return 'Actividades diversas';
  if (theme === 5) return 'Entregas';
  if (theme === 7) return 'Cocción de maíz';
  if (theme === 4) return 'Mantenimiento';
  return null;
}
const OFF = new Set(['Vacaciones', 'Libre', 'Enfermedad']);
const NOTE_DAY = { 'domingo:': 0, 'lunes:': 1, 'martes:': 2, 'miércoles:': 3, 'jueves:': 4, 'viernes:': 5, 'sábado:': 6 };

async function importWeek(ws, people, kinds, products) {
  const title = text(ws.getCell('B1'));
  const m = title.match(/^(\d{2})\.(\d{2})\.(\d{2})\s*-/);
  if (!m) return console.log(`  week    ? ${ws.name}: no dates in "${title}"`);
  const weekStart = `20${m[3]}-${m[2]}-${m[1]}`;
  if (only.length > 0 && !only.includes(weekStart)) return console.log(`  week    - ${weekStart} not asked for`);
  if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 0) return console.log(`  week    ? ${ws.name}: ${weekStart} is not a Sunday`);
  const there = must(await db.from('schedule_weeks').select('id').eq('week_start', weekStart).maybeSingle());
  if (there) return console.log(`  week    = ${weekStart} already in the app`);

  const blocks = [];
  for (let r = 4; r <= 40; r += 1) {
    const nameCell = ws.getCell(r, 2);
    // The name spans both lines of a person: read it once, on its first.
    if (nameCell.isMerged && nameCell.master.address !== nameCell.address) continue;
    const person = people.get(text(nameCell).toLowerCase());
    if (!person) continue;
    for (let day = 0; day < 7; day++) {
      const col = 3 + day * 3;
      let wholeDay = null;
      for (const slot of [1, 2]) {
        const start = ws.getCell(r + slot - 1, col);
        const end = ws.getCell(r + slot - 1, col + 1);
        const kind = kindName(start);
        const from = hm(start.value);
        const until = hm(end.value);
        if (from && until) blocks.push({ person_id: person, day, slot, start_time: from, end_time: until, kind_id: kind ? kinds.get(kind) : null });
        else if (kind && OFF.has(kind)) wholeDay ??= kind;
      }
      // A day off drawn across both lines is one mark for the day.
      if (wholeDay && !blocks.some((b) => b.person_id === person && b.day === day)) {
        blocks.push({ person_id: person, day, slot: 1, start_time: null, end_time: null, kind_id: kinds.get(wholeDay) });
      }
    }
  }

  const day_products = {};
  for (let day = 0; day < 7; day++) {
    const name = text(ws.getCell(2, 3 + day * 3)).toLowerCase();
    if (products.has(name)) day_products[day] = [products.get(name)];
    else if (name) console.log(`  week    ? ${weekStart}: product "${name}" is not on the list`);
  }
  const day_notes = {};
  const cleaning = {};
  ws.eachRow((row) =>
    row.eachCell((cell, col) => {
      const label = text(cell).toLowerCase();
      const next = () => [1, 2, 3].map((k) => text(row.getCell(col + k))).find((v) => v && !v.endsWith(':')) ?? '';
      if (label in NOTE_DAY && row.number > 24 && next()) day_notes[NOTE_DAY[label]] = next();
      if (label === 'baños:' && people.get(next().toLowerCase())) cleaning.cleaning_bathroom = people.get(next().toLowerCase());
      if (label === 'cocina:' && people.get(next().toLowerCase())) cleaning.cleaning_kitchen = people.get(next().toLowerCase());
    }),
  );

  const hours = blocks.reduce((s, b) => {
    if (!b.start_time || [...kinds].some(([name, id]) => id === b.kind_id && OFF.has(name))) return s;
    const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    return s + (mins(b.end_time) - mins(b.start_time)) / 60;
  }, 0);
  const sheetTotal = ws.getCell('X24').value?.result ?? ws.getCell('X24').value;
  console.log(`  week    + ${weekStart}: ${blocks.length} blocks, ${hours.toFixed(2)} h (sheet says ${Number(sheetTotal).toFixed(2)})`);
  if (dry) return;

  const header = { day_products, day_notes, holidays: [], cleaning_bathroom: cleaning.cleaning_bathroom ?? null, cleaning_kitchen: cleaning.cleaning_kitchen ?? null };
  const week = must(await db.from('schedule_weeks').insert({ week_start: weekStart, ...header }).select('id').single());
  must(await db.from('schedule_blocks').insert(blocks.map((b) => ({ ...b, week_id: week.id }))));
  must(await db.from('schedule_week_versions').insert({ week_id: week.id, version: 1, snapshot: { blocks, ...header } }));
  must(await db.from('schedule_weeks').update({ version: 1, published_at: new Date().toISOString() }).eq('id', week.id));
}

/* --------------------------- Sundays and holidays --------------------------- */

function dutyDate(value, year) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const m = String(value ?? '').trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(year);
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function readDuties(ws, year, people) {
  const out = [];
  for (let r = 3; r <= 12; r++) {
    let name = null;
    const row = ws.getRow(r);
    for (let c = 1; c <= ws.columnCount; c++) {
      const value = text(row.getCell(c));
      if (!value) continue;
      const date = dutyDate(ws.getCell(2, c).value, year);
      // A column without a date holds the names of a round.
      if (!date) name = value;
      else if (/^x/i.test(value) && name) {
        const rest = value.slice(1).trim();
        out.push({
          duty_date: date,
          person_name: name,
          person_id: people.get(name.toLowerCase()) ?? null,
          // What stood beside the x — "Jefferson", "con Bruce" — kept as written.
          note: rest ? `Excel: "${value}"` : null,
          origin: date > today ? 'planned' : 'import',
        });
      }
    }
  }
  return out;
}

async function importDuties(wb, people) {
  const duties = [
    ...readDuties(wb.getWorksheet('Cocción domingo_festivos 2025'), 2025, people),
    ...readDuties(wb.getWorksheet('Cocción domingo_festivos 2026'), 2026, people),
  ].sort((a, b) => a.duty_date.localeCompare(b.duty_date));
  const there = must(await db.from('schedule_sunday_duty').select('duty_date, person_name'));
  const known = new Set(there.map((d) => `${d.duty_date}|${d.person_name}`));
  const fresh = duties.filter((d) => !known.has(`${d.duty_date}|${d.person_name}`));
  console.log(`  sundays + ${fresh.length} of ${duties.length} (${duties.filter((d) => d.origin === 'planned').length} still ahead, ${duties.filter((d) => !d.person_id).length} of people no longer on the schedule, ${duties.filter((d) => d.note).length} with a note)`);
  if (!dry && fresh.length > 0) must(await db.from('schedule_sunday_duty').insert(fresh));
}

/* --------------------------------- run --------------------------------- */

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
console.log(dry ? 'DRY RUN — nothing is written' : 'importing');
const people = await importPeople();
const kinds = new Map(must(await db.from('schedule_kinds').select('id, name')).map((k) => [k.name, k.id]));
const products = new Map(must(await db.from('schedule_products').select('id, name')).map((p) => [p.name.toLowerCase(), p.id]));
for (const ws of wb.worksheets.filter((w) => /^Semana \d+$/.test(w.name))) await importWeek(ws, people, kinds, products);
await importDuties(wb, people);
console.log('done');
