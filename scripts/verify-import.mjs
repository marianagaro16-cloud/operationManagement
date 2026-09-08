/**
 * End-to-end verification of the Order Request import schema.
 *
 *   node scripts/verify-import.mjs
 *
 * NOT a unit test. `src/domain/orders/import/*.test.ts` covers the matching,
 * parsing and conversion rules, which are pure. What this checks is the half
 * that only exists in Postgres and that vitest cannot reach:
 *
 *   - RLS on the two new tables really answers to the capabilities claimed
 *   - an alias cannot be made to name two products within one scope
 *   - a customer-scoped alias and a global one coexist, which is the whole
 *     point of the scope
 *   - import_key genuinely prevents a duplicate order, at the database
 *   - units_per_box refuses a nonsense value
 *   - an imported order is an ORDINARY order: it reaches Lotnummerkontrol and
 *     the Lot Nummer Tracker through the same rows as a hand-entered one
 *
 * Every check runs as a REAL signed-in user through the anon key, so what is
 * tested is the path a browser takes. Throwaway accounts and fixtures are
 * created and removed; nothing pre-existing is touched.
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

const PW = 'Throwaway-Test-Pw-9137';
let pass = 0, fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}

/** Denial can arrive as an error OR as an empty result set — RLS filters rows. */
function denied(res) {
  return Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0);
}

async function makeUser(role) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-imp-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({
    email, password: PW, options: { data: { name: `ZZ ${role}` } },
  });
  if (error) throw new Error('signUp: ' + error.message);
  await admin.from('profiles').update({ status: 'approved', role }).eq('id', up.user.id);
  const { data: si } = await anon.auth.signInWithPassword({ email, password: PW });
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
  return { id: up.user.id, email, client, role };
}

const created = { users: [], products: [], customers: [], orders: [], templates: [], aliases: [] };

async function main() {
  const A = await makeUser('admin');
  const M = await makeUser('manager');
  const P = await makeUser('power_user');
  const U = await makeUser('user');
  created.users.push(A.id, M.id, P.id, U.id);

  // ---- fixtures ----
  const { data: cust } = await admin
    .from('customers').insert({ company_name: 'ZZ Import Cust' }).select('id').single();
  const { data: cust2 } = await admin
    .from('customers').insert({ company_name: 'ZZ Import Cust Two' }).select('id').single();
  created.customers.push(cust.id, cust2.id);

  const { data: prodA } = await admin.from('products')
    .insert({ name: 'ZZ Panela Bloque 454g', family: 'ZZ Panela', presentation: '454g', units_per_box: 12 })
    .select('id, units_per_box').single();
  const { data: prodB } = await admin.from('products')
    .insert({ name: 'ZZ Panela Molida 1kg', family: 'ZZ Panela', presentation: '1kg' })
    .select('id, units_per_box').single();
  created.products.push(prodA.id, prodB.id);

  console.log('\n=== 1. Packaging lives in the Product Master and may be absent ===');
  check('units_per_box stores a real figure', Number(prodA.units_per_box) === 12, String(prodA.units_per_box));
  check('units_per_box defaults to NULL — "no reliable conversion"', prodB.units_per_box === null);

  const badBox = await admin.from('products')
    .insert({ name: 'ZZ Bad', family: 'ZZ', presentation: 'x', units_per_box: 0 }).select();
  check('a zero conversion is refused by the CHECK', Boolean(badBox.error));
  const negBox = await admin.from('products')
    .insert({ name: 'ZZ Bad2', family: 'ZZ', presentation: 'x', units_per_box: -3 }).select();
  check('a negative conversion is refused by the CHECK', Boolean(negBox.error));

  console.log('\n=== 2. Aliases resolve to ONE product per scope ===');
  const a1 = await admin.from('product_aliases')
    .insert({ product_id: prodA.id, customer_id: null, alias: 'ZZ panela' }).select('id').single();
  created.aliases.push(a1.data?.id);
  check('a global alias is accepted', !a1.error);

  const dupGlobal = await admin.from('product_aliases')
    .insert({ product_id: prodB.id, customer_id: null, alias: 'ZZ Panela' }).select();
  check('a SECOND global alias with the same text is refused', Boolean(dupGlobal.error),
    'case- and space-insensitive');

  const a2 = await admin.from('product_aliases')
    .insert({ product_id: prodB.id, customer_id: cust.id, alias: 'ZZ panela' }).select('id').single();
  created.aliases.push(a2.data?.id);
  check('the same text CAN be scoped to a customer alongside the global one', !a2.error);

  const a3 = await admin.from('product_aliases')
    .insert({ product_id: prodA.id, customer_id: cust2.id, alias: 'ZZ panela' }).select('id').single();
  created.aliases.push(a3.data?.id);
  check('a second customer may point the same word at a DIFFERENT product', !a3.error);

  const dupCust = await admin.from('product_aliases')
    .insert({ product_id: prodA.id, customer_id: cust.id, alias: 'zz PANELA' }).select();
  check('but not twice within one customer', Boolean(dupCust.error));

  console.log('\n=== 3. RLS: who may configure aliases and templates ===');
  const tplRow = {
    customer_id: cust.id, name: 'ZZ Weekly', sheet_name: 'Pedido', header_row: 1,
    first_data_row: 2, product_column: 'Producto', quantity_column: 'Cantidad',
    header_signature: ['Producto', 'Cantidad'],
  };

  // Aliases are product master data -> products.manage (manager AND power user).
  const puAlias = await P.client.from('product_aliases')
    .insert({ product_id: prodA.id, customer_id: null, alias: 'ZZ pu alias' }).select('id').single();
  check('a POWER USER may configure an alias (products.manage)', !puAlias.error,
    puAlias.error?.message ?? '');
  if (puAlias.data) created.aliases.push(puAlias.data.id);

  const userAlias = await U.client.from('product_aliases')
    .insert({ product_id: prodA.id, customer_id: null, alias: 'ZZ user alias' }).select();
  check('a plain USER may NOT', denied(userAlias));

  // Templates are order CONFIGURATION -> orders.manage_config (manager only).
  const mgrTpl = await M.client.from('order_request_templates').insert(tplRow).select('id').single();
  check('a MANAGER may configure a template (orders.manage_config)', !mgrTpl.error,
    mgrTpl.error?.message ?? '');
  if (mgrTpl.data) created.templates.push(mgrTpl.data.id);

  const puTpl = await P.client.from('order_request_templates')
    .insert({ ...tplRow, name: 'ZZ PU attempt' }).select();
  check('a POWER USER may NOT — that omission IS the manager line', denied(puTpl));

  const userTpl = await U.client.from('order_request_templates')
    .insert({ ...tplRow, name: 'ZZ User attempt' }).select();
  check('a plain USER may NOT', denied(userTpl));

  const userRead = await U.client.from('order_request_templates').select('id').limit(1);
  check('every approved user may READ templates', !userRead.error);
  const userReadAlias = await U.client.from('product_aliases').select('id').limit(1);
  check('every approved user may READ aliases', !userReadAlias.error);

  console.log('\n=== 4. import_key prevents a duplicate order, in the database ===');
  const key = `zz-import-${Date.now()}`;
  const base = {
    customer_id: cust.id, delivery_date: '2026-12-01', preparation_date: '2026-12-01',
    status: 'confirmed', order_type: 'sale', import_source: 'excel', import_key: key,
  };

  const first = await M.client.from('orders').insert(base).select('id, reference').single();
  check('the first import creates the order', !first.error, first.error?.message ?? '');
  if (first.data) created.orders.push(first.data.id);

  const second = await M.client.from('orders').insert(base).select('id');
  check('a SECOND submission of the same import is refused', Boolean(second.error),
    'unique index on import_key');

  const manual1 = await M.client.from('orders')
    .insert({ ...base, import_source: null, import_key: null }).select('id').single();
  const manual2 = await M.client.from('orders')
    .insert({ ...base, import_source: null, import_key: null }).select('id').single();
  check('two MANUAL orders for the same customer and day are still both allowed',
    !manual1.error && !manual2.error, 'the index is partial');
  if (manual1.data) created.orders.push(manual1.data.id);
  if (manual2.data) created.orders.push(manual2.data.id);

  const badSource = await M.client.from('orders')
    .insert({ ...base, import_key: key + '-x', import_source: 'telepathy' }).select();
  check('an unknown import_source is refused by the CHECK', Boolean(badSource.error));

  console.log('\n=== 5. An imported order is an ORDINARY order ===');
  const orderId = first.data.id;
  const { data: line, error: lineErr } = await M.client.from('order_lines')
    .insert({
      order_id: orderId, product_id: prodA.id, ordered_quantity: 36,
      source_text: '3 boxes of panela', position: 0,
    })
    .select('id, ordered_quantity, source_text').single();
  check('an imported line is an ordinary order line', !lineErr, lineErr?.message ?? '');
  check('the quantity is in UNITS, not boxes', Number(line?.ordered_quantity) === 36);
  check('what the customer wrote is kept for traceability',
    line?.source_text === '3 boxes of panela');

  // Lotnummerkontrol reads by preparation_date and excludes cancelled orders.
  const { data: prepDay } = await U.client.from('orders')
    .select('id, status').eq('preparation_date', '2026-12-01').neq('status', 'cancelled');
  check('the imported order appears in Lotnummerkontrol like any other',
    (prepDay ?? []).some((o) => o.id === orderId));

  // The Tracker reads lot_allocations, which a plain USER writes.
  const alloc = await U.client.from('lot_allocations')
    .insert({ order_line_id: line.id, lot_number: 'ZZ-LOT-260910', quantity: 10, created_by: U.id })
    .select('id').single();
  check('a plain USER can prepare the imported order', !alloc.error, alloc.error?.message ?? '');

  const { data: tracked } = await U.client.from('lot_allocations')
    .select('id, order_line_id').ilike('lot_number', '%260910%');
  check('the lot reaches the Lot Nummer Tracker through the same rows',
    (tracked ?? []).some((a) => a.order_line_id === line.id));

  const over = await U.client.from('lot_allocations')
    .insert({ order_line_id: line.id, lot_number: 'ZZ-LOT-OVER', quantity: 999, created_by: U.id })
    .select();
  check('over-allocation is still refused on an imported line', Boolean(over.error));

  console.log('\n=== 6. The audit trail records how the order arrived ===');
  const { data: audit } = await admin.from('order_audit_log')
    .select('action, detail').eq('order_id', orderId).eq('action', 'order_created');
  check('an imported order writes order_created', (audit ?? []).length === 1);
  check('...and the detail says it was imported',
    audit?.[0]?.detail?.import_source === 'excel', JSON.stringify(audit?.[0]?.detail));

  const { data: manualAudit } = await admin.from('order_audit_log')
    .select('detail').eq('order_id', manual1.data.id).eq('action', 'order_created');
  check('a hand-entered order still logs a NULL detail, exactly as before',
    manualAudit?.[0]?.detail === null, JSON.stringify(manualAudit?.[0]?.detail));

  const { data: opAudit } = await M.client.from('order_audit_log')
    .select('id, action').limit(200);
  check('the events are readable from the order log itself',
    (opAudit ?? []).some((r) => r.action === 'order_created'),
    'read under orders.manage since the audit screen was removed');
}

async function cleanup() {
  for (const id of created.orders) await admin.from('orders').delete().eq('id', id);
  for (const id of created.templates) await admin.from('order_request_templates').delete().eq('id', id);
  for (const id of created.aliases) if (id) await admin.from('product_aliases').delete().eq('id', id);
  for (const id of created.products) await admin.from('products').delete().eq('id', id);
  for (const id of created.customers) await admin.from('customers').delete().eq('id', id);
  await admin.from('products').delete().like('name', 'ZZ Bad%');
  for (const id of created.users) {
    await admin.from('security_audit_log').delete().eq('target_user_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

main()
  .catch((e) => { fail++; console.error('\nFATAL:', e.message); })
  .finally(async () => {
    await cleanup();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
