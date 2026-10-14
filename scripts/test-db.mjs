/**
 * The permission tests: who may see and change what, checked in the real
 * database.
 *
 *   npm run test:db            every file in supabase/tests/permissions
 *   npm run test:db -- hr      only files whose name contains "hr"
 *
 * Each file runs in ONE transaction that is always rolled back, after
 * _helpers.sql: the people it makes up, the rows it writes, everything is
 * gone afterwards. Nothing is sent — notices leave from the app's server,
 * never from the database.
 *
 * Document numbers (orders, receptions, incidents) come from sequences, and a
 * sequence does not roll back: a test that inserted one would leave a gap.
 * So inserting into those tables is refused before running, and every run
 * checks that no sequence moved.
 *
 * Runs through the Supabase Management API (SUPABASE_ACCESS_TOKEN and
 * SUPABASE_PROJECT_REF in .env). Exit code 1 if anything failed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
config({ path: '.env', quiet: true });

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must be set in .env');
  process.exitCode = 1;
  throw new Error('missing Supabase settings');
}

const dir = 'supabase/tests/permissions';
const helpers = readFileSync(join(dir, '_helpers.sql'), 'utf8');
const only = process.argv[2];
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql') && !f.startsWith('_'))
  .filter((f) => !only || f.includes(only))
  .sort();

const NUMBERED = /\binsert\s+into\s+(public\.)?(orders|goods_receptions|incidents)\b/i;

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

const SEQUENCES = `(select coalesce(json_object_agg(sequencename, last_value), '{}') from pg_sequences where schemaname = 'public')`;

let pass = 0;
let fail = 0;
for (const file of files) {
  const body = readFileSync(join(dir, file), 'utf8');
  console.log(`\n${file}`);
  if (NUMBERED.test(body)) {
    fail++;
    console.log('  FAIL  inserts into a numbered table (orders, goods_receptions, incidents) — would leave a gap');
    continue;
  }
  const sql = [
    'begin;',
    `create temp table _seq as select ${SEQUENCES} as before;`,
    helpers,
    body,
    `select pg_temp.as_system();`,
    `select pg_temp.check('no document number used up', (select before from _seq)::text = ${SEQUENCES}::text, 'sequences moved');`,
    'select json_agg(_r order by n) as results from _r;',
    'rollback;',
  ].join('\n');

  let rows;
  try {
    rows = (await query(sql))[0]?.results ?? [];
  } catch (e) {
    fail++;
    console.log(`  FAIL  the file did not run: ${String(e.message ?? e).slice(0, 500)}`);
    continue;
  }
  for (const r of rows) {
    if (r.ok) pass++;
    else fail++;
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.ok ? '' : ` — ${r.detail ?? ''}`}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
