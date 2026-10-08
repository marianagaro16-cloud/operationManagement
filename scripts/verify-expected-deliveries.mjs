/**
 * End-to-end verification of expected deliveries.
 *
 *   node scripts/verify-expected-deliveries.mjs
 *
 * The pure logic — the list, lateness, notices, the report — is covered by
 * vitest in src/domain/goods-reception/expected.test.ts. This checks the half
 * that only exists in Postgres:
 *
 *   - the office (Admin, Manager, Power User) and the reception list read
 *     them; a plain user off the list and a Production manager off the list
 *     see nothing
 *   - only the office enters, changes and cancels; nobody deletes
 *   - a day or a week, never both; a week is a Monday; somewhere to put it
 *   - the due day is computed, and a moved date is counted — a week made
 *     exact inside itself is not a move
 *   - a line is a catalogue product or a text, never both
 *   - the receiver closes an entry with a reception of the same supplier,
 *     through the function and not by writing to the entry
 *   - counted quantities mark the reception's quantity check
 *   - one reception closes one entry
 *
 * Every check runs as a REAL signed-in user through the anon key. Throwaway
 * accounts and fixtures are created and removed; nothing pre-existing is
 * touched. Dates are a month ahead, so no scheduled notice can pick them up.
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

const PW = 'Throwaway-Test-Pw-5526';
let pass = 0;
let fail = 0;

function check(label, ok, extra = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`);
  }
}

/** Denial can arrive as an error OR as an empty result — RLS filters rows. */
function denied(res) {
  return Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0);
}

async function makeUser(role, tag) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-grx-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({ email, password: PW, options: { data: { name: `ZZ ${tag}` } } });
  if (error) throw new Error('signUp: ' + error.message);
  await admin.from('profiles').update({ status: 'approved', role }).eq('id', up.user.id);
  const { data: si } = await anon.auth.signInWithPassword({ email, password: PW });
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
  return { id: up.user.id, client };
}

const iso = (d) => d.toISOString().slice(0, 10);
/** A Monday about a month ahead, and days of that week. */
const monday = (() => {
  const d = new Date(Date.now() + 30 * 86_400_000);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
})();
const day = (offset) => iso(new Date(monday.getTime() + offset * 86_400_000));

const created = { users: [], suppliers: [], deliveries: [], receptions: [] };

async function main() {
  const A = await makeUser('admin', 'admin');
  const M = await makeUser('manager', 'manager');
  const P = await makeUser('power_user', 'power');
  const PM = await makeUser('production_manager', 'prodmgr');
  const U = await makeUser('user', 'receiver');
  const V = await makeUser('user', 'other');
  created.users.push(A.id, M.id, P.id, PM.id, U.id, V.id);

  // U is on the reception list; V and the Production manager deliberately are not.
  await admin.from('goods_reception_assignees').insert({ user_id: U.id });

  const { data: suppliers } = await admin
    .from('suppliers')
    .insert([{ name: `ZZ Expected A ${Date.now()}` }, { name: `ZZ Expected B ${Date.now()}` }])
    .select('id');
  const [supplier, other] = suppliers.map((s) => s.id);
  created.suppliers.push(supplier, other);

  const base = { supplier_id: supplier, storage: ['dry'], note: 'ZZ expected' };
  const enter = (who, row) => who.client.from('expected_deliveries').insert({ ...base, created_by: who.id, ...row }).select().single();

  console.log('\n=== 1. Only the office enters them ===');
  const first = await enter(P, { expected_date: day(2), pallets: 17 });
  check('a Power User enters one', !first.error && first.data?.status === 'expected', first.error?.message);
  if (first.data) created.deliveries.push(first.data.id);
  const delivery = first.data;
  check('its due day is the day itself', delivery?.due_date === day(2), delivery?.due_date);

  const byManager = await enter(M, { expected_week: day(0) });
  check('a Manager enters one for a week', !byManager.error, byManager.error?.message);
  if (byManager.data) created.deliveries.push(byManager.data.id);
  check('a week is due on its Friday', byManager.data?.due_date === day(4), byManager.data?.due_date);

  check('the receiver cannot enter one', Boolean((await enter(U, { expected_date: day(1) })).error));
  check('a Production manager off the list cannot enter one', Boolean((await enter(PM, { expected_date: day(1) })).error));
  check('nobody enters one in another name', Boolean((await P.client.from('expected_deliveries').insert({ ...base, expected_date: day(1), created_by: M.id }).select()).error));

  console.log('\n=== 2. The office and the reception list read them ===');
  const seen = async (who) => (await who.client.from('expected_deliveries').select('id').eq('id', delivery.id)).data?.length ?? 0;
  check('Admin reads it', (await seen(A)) === 1);
  check('Manager reads it', (await seen(M)) === 1);
  check('the receiver reads it', (await seen(U)) === 1);
  check('a plain user off the list does not', (await seen(V)) === 0);
  check('a Production manager off the list does not', (await seen(PM)) === 0);

  console.log('\n=== 3. What an entry must say ===');
  check('a day and a week together are refused', Boolean((await enter(P, { expected_date: day(1), expected_week: day(0) })).error));
  check('neither is refused', Boolean((await enter(P, {})).error));
  check('a week that is not a Monday is refused', Boolean((await enter(P, { expected_week: day(2) })).error));
  check('nowhere to put it is refused', Boolean((await enter(P, { expected_date: day(1), storage: [] })).error));

  console.log('\n=== 4. Lines: a product or a text ===');
  const { data: product } = await admin.from('products').select('id').limit(1).single();
  const line = (who, row) => who.client.from('expected_delivery_lines').insert({ delivery_id: delivery.id, quantity: 7, unit: 'pallets', ...row }).select().single();
  const text = await line(P, { description: 'ZZ maíz amarillo' });
  const fromCatalogue = await line(P, { product_id: product.id, quantity: 9 });
  check('a typed line is saved', !text.error, text.error?.message);
  check('a catalogue line is saved', !fromCatalogue.error, fromCatalogue.error?.message);
  check('a line with both is refused', Boolean((await line(P, { product_id: product.id, description: 'ZZ both' })).error));
  check('a line with neither is refused', Boolean((await line(P, {})).error));
  check('the receiver cannot add a line', Boolean((await line(U, { description: 'ZZ no' })).error));
  check('the receiver reads the lines', ((await U.client.from('expected_delivery_lines').select('id').eq('delivery_id', delivery.id)).data ?? []).length === 2);
  check('a user off the list reads no lines', ((await V.client.from('expected_delivery_lines').select('id').eq('delivery_id', delivery.id)).data ?? []).length === 0);

  console.log('\n=== 5. Changing, moving, never deleting ===');
  check('the receiver cannot change it', denied(await U.client.from('expected_deliveries').update({ pallets: 1 }).eq('id', delivery.id).select()));
  const moved = await P.client.from('expected_deliveries').update({ expected_date: day(3) }).eq('id', delivery.id).select().single();
  check('a moved day is counted', moved.data?.moved_count === 1 && moved.data?.due_date === day(3), JSON.stringify(moved.data?.moved_count));
  const noted = await P.client.from('expected_deliveries').update({ note: 'ZZ expected, rack B' }).eq('id', delivery.id).select().single();
  check('a changed note is not a move', noted.data?.moved_count === 1);
  const exact = await M.client.from('expected_deliveries').update({ expected_week: null, expected_date: day(1) }).eq('id', byManager.data.id).select().single();
  check('a week made exact inside itself is not a move', exact.data?.moved_count === 0 && exact.data?.due_date === day(1), exact.error?.message);
  check('nobody deletes one', denied(await A.client.from('expected_deliveries').delete().eq('id', delivery.id).select()));
  check('the notice ledger is closed to the office', ((await P.client.from('expected_delivery_notices').select('delivery_id')).data ?? []).length === 0);

  console.log('\n=== 6. Arrival: one reception closes it ===');
  const receive = async (who, supplierId) => {
    const res = await who.client
      .from('goods_receptions')
      .insert({ supplier_id: supplierId, delivery_note: 'ZZ-EXPECTED', received_by: who.id, created_by: who.id, status: 'draft' })
      .select('id')
      .single();
    if (res.data) created.receptions.push(res.data.id);
    return res.data?.id;
  };
  const reception = await receive(U, supplier);
  const wrongSupplier = await receive(U, other);
  const link = (who, d, r) => who.client.rpc('link_expected_delivery', { p_delivery: d, p_reception: r });

  check('the receiver cannot mark it arrived by hand', denied(await U.client.from('expected_deliveries').update({ status: 'arrived', reception_id: reception }).eq('id', delivery.id).select()));
  check('a user off the list cannot close it', Boolean((await link(V, delivery.id, reception)).error));
  const mismatch = await link(U, delivery.id, wrongSupplier);
  check('a reception of another supplier is refused', mismatch.error?.message.includes('expected_supplier_mismatch'), mismatch.error?.message);
  const linked = await link(U, delivery.id, reception);
  check('the receiver closes it with their reception', !linked.error, linked.error?.message);
  const after = await admin.from('expected_deliveries').select('status, reception_id').eq('id', delivery.id).single();
  check('it is arrived and points at the reception', after.data?.status === 'arrived' && after.data?.reception_id === reception);
  const again = await link(U, delivery.id, reception);
  check('it cannot be closed twice', again.error?.message.includes('expected_not_open'), again.error?.message);

  // A second entry of the same supplier cannot take the same reception.
  const second = await enter(P, { expected_date: day(4) });
  if (second.data) created.deliveries.push(second.data.id);
  const taken = await link(U, second.data.id, reception);
  check('one reception closes one entry', taken.error?.message.includes('reception_already_linked'), taken.error?.message);

  console.log('\n=== 7. Counting against the lines ===');
  const record = (who, lines) => who.client.rpc('record_expected_received', { p_delivery: delivery.id, p_lines: lines });
  check('a user off the list cannot count', Boolean((await record(V, [])).error));
  const short = await record(U, [{ id: text.data.id, received: '6' }, { id: fromCatalogue.data.id, received: '9' }]);
  check('a short line is a difference', short.data === true, short.error?.message);
  const checkOf = async () => (await admin.from('goods_receptions').select('quantity_check').eq('id', reception).single()).data?.quantity_check;
  check("the reception's quantity check says so", (await checkOf()) === 'discrepancy');
  const lineNow = await admin.from('expected_delivery_lines').select('received_quantity').eq('id', text.data.id).single();
  check('what was counted is kept on the line', Number(lineNow.data?.received_quantity) === 6);

  await admin.from('goods_receptions').update({ quantity_check: 'not_checked' }).eq('id', reception);
  const equal = await record(U, [{ id: text.data.id, received: '7' }, { id: fromCatalogue.data.id, received: '9' }]);
  check('everything counted and equal is no difference', equal.data === false, equal.error?.message);
  check('…and marks the check as done', (await checkOf()) === 'checked_ok');

  await admin.from('goods_receptions').update({ quantity_check: 'not_checked' }).eq('id', reception);
  await record(U, [{ id: text.data.id, received: null }, { id: fromCatalogue.data.id, received: '9' }]);
  check('a line nobody counted leaves the check alone', (await checkOf()) === 'not_checked');

  console.log('\n=== 8. Undoing and cancelling ===');
  check('the receiver cannot undo the link', denied(await U.client.from('expected_deliveries').update({ status: 'expected', reception_id: null }).eq('id', delivery.id).select()));
  const undone = await P.client.from('expected_deliveries').update({ status: 'expected', reception_id: null }).eq('id', delivery.id).select().single();
  check('the office undoes it', undone.data?.status === 'expected' && undone.data?.reception_id === null, undone.error?.message);
  check('arrived without a reception is refused', Boolean((await P.client.from('expected_deliveries').update({ status: 'arrived' }).eq('id', delivery.id).select().single()).error));
  check('cancelled without a stamp is refused', Boolean((await P.client.from('expected_deliveries').update({ status: 'cancelled' }).eq('id', delivery.id).select().single()).error));
  const cancelled = await P.client
    .from('expected_deliveries')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: P.id, cancel_reason: 'ZZ' })
    .eq('id', delivery.id)
    .select()
    .single();
  check('the office cancels it, and it is kept', cancelled.data?.status === 'cancelled', cancelled.error?.message);
  check('the receiver still reads the cancelled one', (await seen(U)) === 1);
}

async function cleanup() {
  console.log('\n=== cleanup ===');
  const removals = [
    ['expected deliveries', () => admin.from('expected_deliveries').delete().in('id', created.deliveries)],
    ['receptions', () => admin.from('goods_receptions').delete().in('id', created.receptions)],
    ['assignee rows', () => admin.from('goods_reception_assignees').delete().in('user_id', created.users)],
    ['suppliers', () => admin.from('suppliers').delete().in('id', created.suppliers)],
  ];
  for (const [label, run] of removals) {
    const res = await run();
    if (res.error) check(`cleanup: ${label} removed`, false, res.error.message);
  }
  for (const id of created.users) {
    const res = await admin.auth.admin.deleteUser(id);
    if (res?.error) check('cleanup: throwaway account removed', false, res.error.message);
  }

  // Everything this script writes carries a ZZ mark; anything still matching outlived its cleanup.
  const leaks = [];
  const sweep = [
    ['supplier', await admin.from('suppliers').select('name').like('name', 'ZZ Expected %')],
    ['expected delivery', await admin.from('expected_deliveries').select('id').like('note', 'ZZ expected%')],
    ['line', await admin.from('expected_delivery_lines').select('id').like('description', 'ZZ %')],
    ['reception', await admin.from('goods_receptions').select('reception_number').eq('delivery_note', 'ZZ-EXPECTED')],
    ['account', await admin.from('profiles').select('email').like('email', 'zz-grx-%')],
  ];
  for (const [label, res] of sweep) {
    for (const row of res.data ?? []) leaks.push(`${label} ${Object.values(row)[0]}`);
  }
  check('no fixture survived the cleanup', leaks.length === 0, leaks.join(' | '));
  if (created.receptions.length > 0) {
    console.log(`  NOTE  ${created.receptions.length} reception numbers were used by fixtures; restart goods_receptions.reference at max + 1.`);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error('\nFATAL', e.message);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
