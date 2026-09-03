import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PW = 'Throwaway-Test-Pw-9137';
let pass = 0, fail = 0;
function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}

async function makeUser(role) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({ email, password: PW, options: { data: { name: `T ${role}` } } });
  if (error) throw new Error('signUp: ' + error.message);
  await admin.from('profiles').update({ status: 'approved', role }).eq('id', up.user.id);
  const { data: si } = await anon.auth.signInWithPassword({ email, password: PW });
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
  return { id: up.user.id, client };
}

const created = { orders: [], users: [], products: [], customers: [] };

async function main() {
  const A = await makeUser('admin');
  const U = await makeUser('user');
  created.users.push(A.id, U.id);

  // ---- fixtures ----
  const { data: cust, error: custErr } = await admin
    .from('customers').insert({ company_name: `ZZ Test Customer ${Date.now()}` }).select().single();
  if (custErr) throw new Error('fixture customer: ' + custErr.message);
  created.customers.push(cust.id);

  const stamp = Date.now();
  const { data: prods, error: prodErr } = await admin.from('products').insert([
    // Every row carries the same keys: a bulk insert with heterogeneous keys
    // sends NULL for the missing ones instead of taking the column default.
    { code: `Z${stamp}A`, name: `ZZ Test A ${stamp}`, family: `ZZ Test Family ${stamp}`, presentation: '500gr', is_active: true },
    { code: `Z${stamp}B`, name: `ZZ Test B ${stamp}`, family: `ZZ Test Family ${stamp}`, presentation: '1kg', is_active: true },
    { code: `Z${stamp}C`, name: `ZZ Test C ${stamp}`, family: `ZZ Test Family ${stamp}`, presentation: 'inactive', is_active: false },
  ]).select();
  if (prodErr) throw new Error('fixture products: ' + prodErr.message);
  created.products.push(...prods.map((p) => p.id));
  const [pA, pB, pInactive] = prods;
  const { data: method } = await admin.from('delivery_methods').select('*').eq('slug', 'dhl').single();

  console.log('\n=== 1. Admin creates ONE order: deliver Thu 10th, prepare Wed 9th ===');
  const { data: order, error: oErr } = await A.client.from('orders').insert({
    customer_id: cust.id,
    delivery_date: '2026-09-10',
    preparation_date: '2026-09-09',
    delivery_method_id: method.id,
    status: 'confirmed',
    order_type: 'sale',
    note: 'Customer requested delivery after 14:00.',
    created_by: A.id, updated_by: A.id,
  }).select().single();
  check('admin can create an order', !oErr, oErr?.message);
  created.orders.push(order.id);

  const { data: lines } = await A.client.from('order_lines').insert([
    { order_id: order.id, product_id: pA.id, ordered_quantity: 10, position: 0 },
    { order_id: order.id, product_id: pB.id, ordered_quantity: 5, position: 1 },
  ]).select();
  check('admin can add order lines', lines?.length === 2);
  const [lineA, lineB] = lines.sort((a, b) => a.position - b.position);
  check('order has a human reference', typeof order.reference === 'number', `#${order.reference}`);

  console.log('\n=== 1b. Delivery time ===');
  const { error: timeErr } = await A.client.from('orders').update({ delivery_time: '14:00' }).eq('id', order.id);
  check('admin can set a delivery time', !timeErr, timeErr?.message);
  const { data: withTime } = await admin.from('orders').select('delivery_time').eq('id', order.id).single();
  check('stored as a wall-clock time', withTime.delivery_time === '14:00:00', withTime.delivery_time);
  await U.client.from('orders').update({ delivery_time: '23:59' }).eq('id', order.id);
  const { data: afterUserTime } = await admin.from('orders').select('delivery_time').eq('id', order.id).single();
  check('user cannot change the delivery time', afterUserTime.delivery_time === '14:00:00');
  const { data: auditTime } = await A.client.from('order_audit_log').select('detail').eq('order_id', order.id).eq('action', 'order_updated');
  check('delivery time change is audited',
    auditTime.some((a) => a.detail?.after?.delivery_time === '14:00:00'));

  console.log('\n=== 2. Same order appears in BOTH views, from one entry ===');
  const { data: control } = await U.client.from('orders').select('id').eq('delivery_date', '2026-09-10').eq('id', order.id);
  check('Order Control finds it by DELIVERY date (10th)', control?.length === 1);
  const { data: prep } = await U.client.from('orders').select('id').eq('preparation_date', '2026-09-09').neq('status', 'cancelled').eq('id', order.id);
  check('Lotnummerkontrol finds it by PREPARATION date (9th)', prep?.length === 1);
  const { data: notOn10 } = await U.client.from('orders').select('id').eq('preparation_date', '2026-09-10').eq('id', order.id);
  check('it does NOT appear in preparation on the delivery date', notOn10?.length === 0);

  console.log('\n=== 3. User records lots without re-entering anything ===');
  const { error: l1 } = await U.client.from('lot_allocations').insert({ order_line_id: lineA.id, lot_number: '260901', quantity: 6, created_by: U.id });
  const { error: l2 } = await U.client.from('lot_allocations').insert({ order_line_id: lineA.id, lot_number: '260902', quantity: 4, created_by: U.id });
  check('user can record multiple lots on one line', !l1 && !l2, (l1 || l2)?.message);
  const { data: allocs } = await U.client.from('lot_allocations').select('quantity').eq('order_line_id', lineA.id);
  const total = allocs.reduce((s, a) => s + Number(a.quantity), 0);
  check('quantities aggregate to 10 (6 + 4)', total === 10, `total=${total}`);

  console.log('\n=== 4. Over-allocation is blocked for a user, allowed for admin ===');
  const { error: over } = await U.client.from('lot_allocations').insert({ order_line_id: lineA.id, lot_number: '260903', quantity: 2, created_by: U.id });
  check('user CANNOT over-allocate', !!over, over?.message?.slice(0, 40));
  const { error: adminOver } = await A.client.from('lot_allocations').insert({ order_line_id: lineA.id, lot_number: '260904', quantity: 2, created_by: A.id });
  check('admin CAN over-allocate to correct reality', !adminOver, adminOver?.message);
  if (!adminOver) await admin.from('lot_allocations').delete().eq('lot_number', '260904');

  console.log('\n=== 5. User cannot touch protected order data ===');
  await U.client.from('orders').update({ delivery_date: '2026-12-01', note: 'HACKED' }).eq('id', order.id);
  const { data: afterU } = await admin.from('orders').select('delivery_date, note').eq('id', order.id).single();
  check('user cannot change delivery date', afterU.delivery_date === '2026-09-10');
  check('user cannot change the order note', afterU.note !== 'HACKED');
  await U.client.from('order_lines').update({ ordered_quantity: 999 }).eq('id', lineA.id);
  const { data: lineAfterU } = await admin.from('order_lines').select('ordered_quantity').eq('id', lineA.id).single();
  check('user cannot change ordered quantity', Number(lineAfterU.ordered_quantity) === 10);
  await U.client.from('products').update({ family: 'HACKED' }).eq('id', pA.id);
  const { data: prodAfter } = await admin.from('products').select('family').eq('id', pA.id).single();
  check('user cannot edit the product master', prodAfter.family !== 'HACKED');
  await U.client.from('customers').update({ company_name: 'HACKED' }).eq('id', cust.id);
  const { data: custAfter } = await admin.from('customers').select('company_name').eq('id', cust.id).single();
  check('user cannot edit the customer master', custAfter.company_name !== 'HACKED');

  console.log('\n=== 6. Admin changes quantity after preparation started ===');
  await A.client.from('order_lines').update({ ordered_quantity: 12 }).eq('id', lineA.id);
  const { data: reAllocs } = await admin.from('lot_allocations').select('quantity').eq('order_line_id', lineA.id);
  const reTotal = reAllocs.reduce((s, a) => s + Number(a.quantity), 0);
  const { data: reLine } = await admin.from('order_lines').select('ordered_quantity').eq('id', lineA.id).single();
  check('ordered quantity updated to 12', Number(reLine.ordered_quantity) === 12);
  check('preparation history preserved (still 10 allocated)', reTotal === 10);
  check('remaining recalculates to 2', Number(reLine.ordered_quantity) - reTotal === 2);

  console.log('\n=== 7. Partial preparation requires a reason ===');
  await U.client.from('lot_allocations').insert({ order_line_id: lineB.id, lot_number: '260905', quantity: 3, created_by: U.id });
  const { error: emptyReason } = await U.client.rpc('set_line_shortfall_reason', { p_order_line_id: lineB.id, p_reason: '   ' });
  check('blank reason is rejected', !!emptyReason, emptyReason?.message?.slice(0, 30));
  const { error: goodReason } = await U.client.rpc('set_line_shortfall_reason', { p_order_line_id: lineB.id, p_reason: 'Only 3 packs in stock' });
  check('user CAN record a shortfall reason', !goodReason, goodReason?.message);
  const { data: lineBAfter } = await admin.from('order_lines').select('shortfall_reason').eq('id', lineB.id).single();
  check('reason stored on the line', lineBAfter.shortfall_reason === 'Only 3 packs in stock');

  console.log('\n=== 8. Lot number is mandatory; free text is accepted ===');
  const { error: noLot } = await U.client.from('lot_allocations').insert({ order_line_id: lineB.id, lot_number: '  ', quantity: 1, created_by: U.id });
  check('empty lot number rejected', !!noLot);
  const { error: freeLot } = await U.client.from('lot_allocations').insert({ order_line_id: lineB.id, lot_number: 'ABC-XYZ/2026', quantity: 1, created_by: U.id });
  check('arbitrary lot number accepted (no lot master)', !freeLot, freeLot?.message);

  console.log('\n=== 9. Inactive product / historical display ===');
  const { error: inactiveErr } = await A.client.from('order_lines').insert({ order_id: order.id, product_id: pInactive.id, ordered_quantity: 1, position: 9 });
  // The DB permits it; the server action is what blocks inactive products on
  // NEW orders. What matters here is that historical rows still resolve.
  if (!inactiveErr) await admin.from('order_lines').delete().eq('order_id', order.id).eq('product_id', pInactive.id);
  await admin.from('products').update({ is_active: false }).eq('id', pA.id);
  const { data: histLine } = await U.client.from('order_lines').select('id, product:products(family, presentation, is_active)').eq('id', lineA.id).single();
  check('historical order still displays a now-inactive product', histLine?.product?.is_active === false && !!histLine.product.family);
  await admin.from('products').update({ is_active: true }).eq('id', pA.id);

  console.log('\n=== 10. Cancelled order drops out of preparation, is kept for the record ===');
  await A.client.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
  const { data: prepAfterCancel } = await U.client.from('orders').select('id').eq('preparation_date', '2026-09-09').neq('status', 'cancelled').eq('id', order.id);
  check('cancelled order is not in preparation', prepAfterCancel?.length === 0);
  const { data: stillThere } = await U.client.from('orders').select('id').eq('id', order.id);
  check('cancelled order still exists in the record', stillThere?.length === 1);
  await A.client.from('orders').update({ status: 'confirmed' }).eq('id', order.id);

  console.log('\n=== 11. Audit log ===');
  const { data: audit } = await A.client.from('order_audit_log').select('action').eq('order_id', order.id);
  const actions = (audit ?? []).map((a) => a.action);
  check('order creation logged', actions.includes('order_created'));
  check('quantity change logged', actions.includes('quantity_changed'));
  check('status/definition change logged', actions.includes('order_updated'));
  const { data: userAudit } = await U.client.from('order_audit_log').select('id').eq('order_id', order.id);
  check('user cannot read the audit log', (userAudit?.length ?? 0) === 0);

  console.log('\n=== 12. Recurring template proposes a DRAFT, never a confirmed order ===');
  const { data: tpl } = await admin.from('recurring_order_templates').insert({
    customer_id: cust.id, delivery_weekday: 4, preparation_lead_days: 1, is_active: true,
  }).select().single();
  await admin.from('recurring_order_template_lines').insert({ template_id: tpl.id, product_id: pB.id, default_quantity: 7 });
  const { data: gen, error: genErr } = await A.client.rpc('generate_order_from_template', { p_template_id: tpl.id, p_delivery_date: '2026-09-17' });
  check('admin can generate from a template', !genErr, genErr?.message);
  if (gen) {
    created.orders.push(gen.id);
    check('generated order is a DRAFT', gen.status === 'draft', gen.status);
    check('preparation lead applied (17th -> 16th)', gen.preparation_date === '2026-09-16', gen.preparation_date);
    const { data: genLines } = await admin.from('order_lines').select('ordered_quantity').eq('order_id', gen.id);
    check('template lines copied', genLines?.length === 1 && Number(genLines[0].ordered_quantity) === 7);
  }
  const { error: userGen } = await U.client.rpc('generate_order_from_template', { p_template_id: tpl.id, p_delivery_date: '2026-09-24' });
  check('user cannot generate orders', !!userGen);
  await admin.from('recurring_order_templates').delete().eq('id', tpl.id);
}

main()
  .catch((e) => { console.error('\nFATAL: ' + e.message); fail++; })
  .finally(async () => {
    for (const id of created.orders) await admin.from('orders').delete().eq('id', id);
    for (const id of created.products) await admin.from('products').delete().eq('id', id);
    for (const id of created.customers) await admin.from('customers').delete().eq('id', id);
    for (const id of created.users) await admin.auth.admin.deleteUser(id);
    console.log(`\ncleanup done.  PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  });
