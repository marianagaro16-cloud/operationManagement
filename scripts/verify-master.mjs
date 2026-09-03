/**
 * End-to-end verification of the master-data reshape.
 * Creates throwaway accounts and fixtures, asserts by reading data back,
 * and removes everything it created.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PW = 'Throwaway-Test-Pw-9137';
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
};

const created = { users: [], orders: [], customers: [], products: [] };

async function makeUser(role) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-md-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({ email, password: PW, options: { data: { name: `MD ${role}` } } });
  if (error) throw new Error('signUp: ' + error.message);
  await admin.from('profiles').update({ status: 'approved', role }).eq('id', up.user.id);
  const { data: si } = await anon.auth.signInWithPassword({ email, password: PW });
  return {
    id: up.user.id,
    client: createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
    }),
  };
}

async function main() {
  const A = await makeUser('admin');
  const U = await makeUser('user');
  created.users.push(A.id, U.id);

  console.log('\n=== 1. Imported master data ===');
  const { count: custActive } = await admin.from('customers').select('id', { count: 'exact', head: true }).eq('is_active', true);
  const { count: custTotal } = await admin.from('customers').select('id', { count: 'exact', head: true });
  const { count: prodActive } = await admin.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true);
  const { count: prodTotal } = await admin.from('products').select('id', { count: 'exact', head: true });
  check('216 active customers', custActive === 216, `${custActive} active / ${custTotal} total`);
  check('261 active products', prodActive === 261, `${prodActive} active / ${prodTotal} total`);
  check('inactive products preserved, not deleted', prodTotal > prodActive, `${prodTotal - prodActive} inactive`);

  console.log('\n=== 2. Customer fields kept separate ===');
  const { data: withAdd } = await admin
    .from('customers').select('company_name, company_name_addition, name')
    .not('company_name_addition', 'is', null).limit(1).single();
  check('company_name stored', !!withAdd.company_name, withAdd.company_name);
  check('company_name_addition stored separately', !!withAdd.company_name_addition, withAdd.company_name_addition);
  check('display name derives from both',
    withAdd.name === `${withAdd.company_name} — ${withAdd.company_name_addition}`, withAdd.name);
  const { data: noAdd } = await admin
    .from('customers').select('company_name, name').is('company_name_addition', null).limit(1).single();
  check('display name is just the company when no addition', noAdd.name === noAdd.company_name, noAdd.name);

  console.log('\n=== 3. Same company name, different addition ===');
  const { data: dup } = await admin
    .from('customers').select('company_name, company_name_addition')
    .ilike('company_name', 'Damn Delicious%');
  check('both "Damn Delicious GmbH" rows imported', dup.length === 2,
    dup.map((d) => d.company_name_addition).join(' | '));

  console.log('\n=== 4. Product identity ===');
  const { data: prods } = await admin.from('products').select('code, name, is_active').eq('is_active', true);
  const codes = prods.map((p) => p.code);
  check('every active product has a code', codes.every(Boolean));
  check('active codes are unique', new Set(codes).size === codes.length, `${new Set(codes).size} unique`);
  check('names are stored', prods.every((p) => p.name && p.name.trim().length > 0));
  const sample = prods.find((p) => p.code === '0073');
  check('name kept verbatim', sample?.name === 'Bio Mais Tortillas 1kg - Ø06cm', sample?.name);

  console.log('\n=== 5. Names are NOT parsed into structured fields ===');
  const { data: newProd } = await admin
    .from('products').select('name, category, presentation').eq('code', '0073').single();
  check('category left null (not inferred from name)', newProd.category === null);
  check('presentation not populated from the name', newProd.presentation === '—', newProd.presentation);

  console.log('\n=== 6. Unique code enforced by the database ===');
  const stamp = Date.now();
  const { data: p1 } = await admin.from('products')
    .insert({ code: `ZZ${stamp}`, name: 'ZZ Test A', family: 'ZZ Test A', presentation: '—', is_active: true })
    .select().single();
  created.products.push(p1.id);
  const { error: dupErr } = await admin.from('products')
    .insert({ code: `ZZ${stamp}`, name: 'ZZ Test B', family: 'ZZ Test B', presentation: '—', is_active: true });
  check('duplicate ACTIVE code rejected', !!dupErr, dupErr?.code);
  const { data: p2, error: inactiveDup } = await admin.from('products')
    .insert({ code: `ZZ${stamp}`, name: 'ZZ Test C', family: 'ZZ Test C', presentation: '—', is_active: false })
    .select().single();
  check('same code allowed on an INACTIVE row (history keeps its code)', !inactiveDup, inactiveDup?.message);
  if (p2) created.products.push(p2.id);

  console.log('\n=== 7. Duplicate customer identity rejected ===');
  const { data: c1 } = await admin.from('customers')
    .insert({ company_name: `ZZ Co ${stamp}`, company_name_addition: 'Alpha', is_active: true }).select().single();
  created.customers.push(c1.id);
  const { error: cDup } = await admin.from('customers')
    .insert({ company_name: `ZZ Co ${stamp}`, company_name_addition: 'Alpha' });
  check('same company + same addition rejected', !!cDup, cDup?.code);
  const { data: c2, error: cOk } = await admin.from('customers')
    .insert({ company_name: `ZZ Co ${stamp}`, company_name_addition: 'Beta', is_active: true }).select().single();
  check('same company + DIFFERENT addition allowed', !cOk, cOk?.message);
  if (c2) created.customers.push(c2.id);

  console.log('\n=== 8. Order flow uses the new master data ===');
  const { data: cust } = await admin.from('customers').select('id, name').eq('is_active', true).limit(1).single();
  const { data: prod } = await admin.from('products').select('id, code, name').eq('is_active', true).limit(1).single();
  const { data: order, error: oErr } = await A.client.from('orders').insert({
    customer_id: cust.id, delivery_date: '2026-09-10', preparation_date: '2026-09-09',
    status: 'confirmed', order_type: 'sale', created_by: A.id, updated_by: A.id,
  }).select().single();
  check('admin creates an order against an imported customer', !oErr, oErr?.message);
  created.orders.push(order.id);
  const { error: lErr } = await A.client.from('order_lines')
    .insert({ order_id: order.id, product_id: prod.id, ordered_quantity: 10, position: 0 });
  check('order line references an imported product', !lErr, lErr?.message);

  const { data: joined } = await U.client.from('orders')
    .select('reference, customer:customers(company_name, company_name_addition), lines:order_lines(product:products(code, name))')
    .eq('id', order.id).single();
  check('Order Control resolves customer via the master', !!joined.customer.company_name);
  check('Order Control resolves product code + name',
    !!joined.lines[0].product.code && !!joined.lines[0].product.name,
    `[${joined.lines[0].product.code}] ${joined.lines[0].product.name}`);

  const { data: prep } = await U.client.from('orders')
    .select('id, customer:customers(name), lines:order_lines(product:products(name))')
    .eq('preparation_date', '2026-09-09').eq('id', order.id).single();
  check('Lotnummerkontrol reads the SAME order and master rows', !!prep.customer.name && !!prep.lines[0].product.name);

  console.log('\n=== 9. Historical order with a now-inactive product/customer ===');
  await admin.from('products').update({ is_active: false }).eq('id', prod.id);
  await admin.from('customers').update({ is_active: false }).eq('id', cust.id);
  const { data: hist } = await U.client.from('orders')
    .select('reference, customer:customers(company_name, is_active), lines:order_lines(product:products(code, name, is_active))')
    .eq('id', order.id).single();
  check('inactive customer still displays on the order',
    hist.customer.is_active === false && !!hist.customer.company_name, hist.customer.company_name);
  check('inactive product still displays on the order line',
    hist.lines[0].product.is_active === false && !!hist.lines[0].product.name, hist.lines[0].product.name);
  await admin.from('products').update({ is_active: true }).eq('id', prod.id);
  await admin.from('customers').update({ is_active: true }).eq('id', cust.id);

  console.log('\n=== 10. Permissions ===');
  await U.client.from('customers').update({ company_name: 'HACKED' }).eq('id', c1.id);
  const { data: cAfter } = await admin.from('customers').select('company_name').eq('id', c1.id).single();
  check('user cannot edit a customer', cAfter.company_name !== 'HACKED');
  await U.client.from('products').update({ name: 'HACKED' }).eq('id', p1.id);
  const { data: pAfter } = await admin.from('products').select('name').eq('id', p1.id).single();
  check('user cannot edit a product', pAfter.name !== 'HACKED');
  const { error: uIns } = await U.client.from('customers').insert({ company_name: 'ZZ user made' });
  check('user cannot create a customer', !!uIns, uIns?.code);
  const { data: uReads } = await U.client.from('products').select('id').limit(5);
  check('user CAN read products', (uReads?.length ?? 0) > 0);

  const { error: aEdit } = await A.client.from('customers')
    .update({ company_name_addition: 'Edited' }).eq('id', c1.id);
  check('admin CAN edit a customer', !aEdit, aEdit?.message);
  const { error: aReact } = await A.client.from('products').update({ is_active: true }).eq('id', p1.id);
  check('admin CAN reactivate a product', !aReact, aReact?.message);

  console.log('\n=== 11. Search ===');
  const { data: byCode } = await admin.from('products').select('code').eq('is_active', true).ilike('code', '0073');
  check('search products by code', byCode.length === 1);
  const { data: byName } = await admin.from('products').select('name').eq('is_active', true).ilike('name', '%Tortillas%');
  check('search products by name', byName.length > 0, `${byName.length} hits`);
  const { data: byCompany } = await admin.from('customers').select('company_name').ilike('company_name', '%Almas%');
  check('search customers by company name', byCompany.length > 0, byCompany[0]?.company_name);
  const { data: byAddition } = await admin.from('customers')
    .select('company_name, company_name_addition').ilike('company_name_addition', '%Catedral%');
  check('search customers by company name addition', byAddition.length > 0,
    `${byAddition[0]?.company_name} / ${byAddition[0]?.company_name_addition}`);
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
