/**
 * Performance baseline for the operational pages.
 *
 *   node scripts/perf-baseline.mjs
 *
 * Runs the REAL queries the server components run, as a REAL signed-in user
 * through the anon key so RLS applies — measuring with the service role would
 * bypass every policy and understate the cost that dominates this app.
 *
 * Exists so a future change that makes a page slower is visible as a number
 * rather than as a complaint. Re-run it after touching a query, a policy or a
 * select list, and compare against the figures in the header below.
 *
 * RECORDED 2026-09-10, from a developer machine (so every figure carries one
 * network round trip of ~65 ms that a Vercel function colocated with the
 * database would not pay). The RELATIVE numbers are the point.
 *
 *                                    before RLS fix   after
 *   viewer resolution                     180 ms       62 ms
 *   customers + type embed                148 ms       89 ms
 *   products select *                     146 ms       99 ms
 *   inventory instances+items+entries     356 ms      190 ms
 *   audit log, 1000 rows                  324 ms      104 ms
 *   orders list                           135 ms      114 ms
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !service) {
  console.error('NEXT_PUBLIC_SUPABASE_URL, ANON key and SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const admin = createClient(url, service, { auth: { persistSession: false } });
const results = [];
let created = null;

async function makeUser(role) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-perf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({
    email, password: 'Throwaway-Perf-Pw-4471', options: { data: { name: 'ZZ perf' } },
  });
  if (error) throw new Error('signUp: ' + error.message);
  await admin.from('profiles').update({ status: 'approved', role }).eq('id', up.user.id);
  const { data: si } = await anon.auth.signInWithPassword({
    email, password: 'Throwaway-Perf-Pw-4471',
  });
  created = up.user.id;
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
}

/** Median of five, plus the payload the browser would receive. */
async function time(page, label, run) {
  const samples = [];
  let bytes = 0;
  let rows = 0;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const res = await run();
    samples.push(performance.now() - t0);
    if (i === 0) {
      bytes = Buffer.byteLength(JSON.stringify(res?.data ?? []), 'utf8');
      rows = Array.isArray(res?.data) ? res.data.length : res?.data ? 1 : 0;
    }
  }
  samples.sort((a, b) => a - b);
  results.push({ page, label, ms: Math.round(samples[2]), bytes, rows });
}

async function main() {
  const db = await makeUser('admin');
  const today = new Date().toISOString().slice(0, 10);

  await time('EVERY PAGE', 'get_viewer (one round trip)', () => db.rpc('get_viewer'));
  await time('DASHBOARD', 'occurrences + task', () =>
    db.from('task_occurrences').select('*, task:tasks ( *, category:categories ( * ) )').lte('effective_due_date', today));
  await time('ORDERS', 'order list', () =>
    db.from('orders').select('*, customer:customers ( * ), delivery_method:delivery_methods ( * ), lines:order_lines ( *, product:products ( * ), allocations:lot_allocations ( * ) )').gte('delivery_date', today));
  await time('MASTER', 'customers + type', () =>
    db.from('customers').select('*, customer_type:customer_types ( id, slug, name, sort_order, is_active )').order('name'));
  await time('MASTER', 'products + brand', () =>
    db.from('products').select('*, brand:brands ( id, name, sort_order, is_active )').order('name', { nullsFirst: false }));
  await time('LOT TRACKER', 'allocations + order', () =>
    db.from('lot_allocations').select('*, order_line:order_lines ( *, product:products ( * ), order:orders ( *, customer:customers ( * ) ) )'));
  await time('RECEPTION', 'list page', () =>
    db.from('goods_receptions').select('*, supplier:suppliers ( id, name ), transporter:transporters ( id, name ), exceptions:goods_reception_exceptions ( id ), incidents ( id )').range(0, 24));
  await time('INCIDENTS', 'list page', () =>
    db.from('incidents').select('*, customer:customers ( id, name ), items:incident_affected_items ( id )', { count: 'exact' }).range(0, 24));

  console.log('\npage            query                            ms    rows     KB');
  console.log('─'.repeat(70));
  let last = '';
  for (const r of results) {
    const page = r.page === last ? '' : r.page;
    last = r.page;
    console.log(`${page.padEnd(15)} ${r.label.padEnd(32)} ${String(r.ms).padStart(4)} ${String(r.rows).padStart(6)} ${(r.bytes / 1024).toFixed(1).padStart(6)}`);
  }
}

main()
  .catch((e) => console.error('FATAL', e.message))
  .finally(async () => {
    if (created) await admin.auth.admin.deleteUser(created).catch(() => {});
    const { data: leak } = await admin.from('profiles').select('email').like('email', 'zz-perf-%');
    console.log(`\ncleanup: ${(leak ?? []).length === 0 ? 'no fixtures left' : 'LEAK ' + JSON.stringify(leak)}`);
  });
