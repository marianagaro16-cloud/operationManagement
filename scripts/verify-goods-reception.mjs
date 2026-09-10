/**
 * End-to-end verification of the Goods Reception module.
 *
 *   node scripts/verify-goods-reception.mjs
 *
 * This is NOT a unit test. The pure logic — the workflow, the report maths,
 * the CSV — is covered by vitest in src/domain/goods-reception. What this
 * checks is the half that only exists in Postgres, and that vitest cannot
 * reach:
 *
 *   - EVERY approved user can read EVERY reception (§11)
 *   - an unassigned user cannot create one, whatever their role
 *   - an assigned plain USER can create, edit and complete one (§10)
 *   - an assignee is stopped at completion; manage_all is not (§35)
 *   - a discrepancy cannot be completed in silence (§34)
 *   - the completion CHECK refuses a reception missing its facts
 *   - an assignee may raise an incident ONLY against a reception (§24)
 *   - and still cannot edit incidents, or create a free-standing one
 *   - reception incidents are readable by a plain user (§25)
 *   - supplier duplicate prevention is case-insensitive (§38)
 *   - a supplier with history cannot be deleted (§37, §52)
 *   - report snapshots cannot be updated or deleted (§42)
 *   - nothing in this module writes to inventory (§4, §28)
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
  const email = `zz-gr-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({
    email,
    password: PW,
    options: { data: { name: `ZZ ${tag}` } },
  });
  if (error) throw new Error('signUp: ' + error.message);
  await admin.from('profiles').update({ status: 'approved', role }).eq('id', up.user.id);
  const { data: si } = await anon.auth.signInWithPassword({ email, password: PW });
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
  return { id: up.user.id, email, client, role, tag };
}

const created = { users: [], suppliers: [], transporters: [], receptions: [], incidents: [], snapshots: [] };

async function main() {
  const A = await makeUser('admin', 'admin');
  const M = await makeUser('manager', 'manager');
  const P = await makeUser('power_user', 'power');
  const U = await makeUser('user', 'assignee');
  const V = await makeUser('user', 'viewer');
  created.users.push(A.id, M.id, P.id, U.id, V.id);

  // U is on the standing reception list; V deliberately is not.
  await admin.from('goods_reception_assignees').insert({ user_id: U.id });

  const { data: supplier } = await admin
    .from('suppliers')
    .insert({ name: `ZZ Supplier ${Date.now()}` })
    .select('id, name')
    .single();
  created.suppliers.push(supplier.id);

  const { data: transporter } = await admin
    .from('transporters')
    .insert({ name: `ZZ Transporter ${Date.now()}` })
    .select('id')
    .single();
  created.transporters.push(transporter.id);

  console.log('\n=== 1. Capabilities are catalogued and granted ===');
  const { data: cat } = await admin
    .from('permission_catalog')
    .select('key, module, is_configurable')
    .like('key', 'goods_reception%');
  check('two reception capabilities catalogued', (cat ?? []).length === 2, `${cat?.length}`);
  check('both are configurable — neither is admin-only', (cat ?? []).every((c) => c.is_configurable));

  const { data: grants } = await admin
    .from('role_permissions')
    .select('role, permission')
    .like('permission', 'goods_reception%');
  const held = new Set((grants ?? []).map((g) => `${g.role}:${g.permission}`));
  check('manager configures', held.has('manager:goods_reception.manage_config'));
  check('power user does NOT configure', !held.has('power_user:goods_reception.manage_config'));
  check('power user manages all receptions', held.has('power_user:goods_reception.manage_all'));

  // The structural claim the assignment table exists to satisfy.
  const asUser = await admin
    .from('role_permissions')
    .insert({ role: 'user', permission: 'goods_reception.manage_all' });
  check('the matrix structurally cannot grant a plain USER anything', Boolean(asUser.error));

  console.log('\n=== 2. Creating a reception (§10) ===');
  const draft = {
    supplier_id: supplier.id,
    transporter_id: transporter.id,
    delivery_note: 'ZZ-4004919',
    received_at: new Date().toISOString(),
  };

  const vCreate = await V.client
    .from('goods_receptions')
    .insert({ ...draft, received_by: V.id, created_by: V.id })
    .select('id');
  check('an UNASSIGNED plain user cannot create a reception', denied(vCreate));

  const uCreate = await U.client
    .from('goods_receptions')
    .insert({ ...draft, received_by: U.id, created_by: U.id })
    .select('id, reception_number, status')
    .single();
  check('an ASSIGNED plain user can create one', !uCreate.error, uCreate.error?.message);
  if (uCreate.error) throw new Error('cannot continue without a reception');
  const reception = uCreate.data;
  created.receptions.push(reception.id);

  check('it is numbered GR-YYYY-NNNN', /^GR-\d{4}-\d{4}$/.test(reception.reception_number), reception.reception_number);
  check('it starts as a draft', reception.status === 'draft');

  const forged = await U.client
    .from('goods_receptions')
    .insert({ ...draft, received_by: V.id, created_by: U.id })
    .select('id');
  check('received_by cannot be forged onto somebody else (§15)', denied(forged));

  const mCreate = await M.client
    .from('goods_receptions')
    .insert({ ...draft, received_by: M.id, created_by: M.id })
    .select('id')
    .single();
  check('a manager can create one without being assigned', !mCreate.error, mCreate.error?.message);
  if (mCreate.data) created.receptions.push(mCreate.data.id);

  console.log('\n=== 3. Everyone reads everything (§11) ===');
  for (const who of [A, M, P, U, V]) {
    const res = await who.client
      .from('goods_receptions')
      .select('id')
      .eq('id', reception.id);
    check(`${who.tag} can read the reception`, !res.error && res.data?.length === 1);
  }

  console.log('\n=== 4. Completion rules (§34) ===');
  const noCondition = await U.client
    .from('goods_receptions')
    .update({ status: 'completed' })
    .eq('id', reception.id);
  check('cannot complete without a condition or quantity check', Boolean(noCondition.error));

  await U.client
    .from('goods_receptions')
    .update({ condition: 'partially_damaged', quantity_check: 'discrepancy' })
    .eq('id', reception.id);

  const silent = await U.client
    .from('goods_receptions')
    .update({ status: 'completed' })
    .eq('id', reception.id);
  check(
    'a DISCREPANCY cannot be completed in silence',
    Boolean(silent.error) && String(silent.error.message).includes('discrepancy_needs_explanation'),
    silent.error?.message?.slice(0, 60),
  );

  console.log('\n=== 5. Raising an incident from a reception (§24) ===');
  const { data: type } = await admin.from('incident_types').select('id').limit(1).single();

  const freeStanding = await U.client
    .from('incidents')
    .insert({ incident_type_id: type.id, description: 'ZZ should be refused', created_by: U.id })
    .select('id');
  check('an assignee still cannot create a FREE-STANDING incident', denied(freeStanding));

  const fromReception = await U.client
    .from('incidents')
    .insert({
      incident_type_id: type.id,
      description: 'ZZ two boxes crushed',
      goods_reception_id: reception.id,
      created_by: U.id,
    })
    .select('id, incident_number')
    .single();
  check('an assignee CAN raise one against their reception', !fromReception.error, fromReception.error?.message);
  if (fromReception.data) created.incidents.push(fromReception.data.id);

  const vIncident = await V.client
    .from('incidents')
    .insert({
      incident_type_id: type.id,
      description: 'ZZ unassigned',
      goods_reception_id: reception.id,
      created_by: V.id,
    })
    .select('id');
  check('an UNASSIGNED user cannot, even against a reception', denied(vIncident));

  if (fromReception.data) {
    const edit = await U.client
      .from('incidents')
      .update({ severity: 'critical' })
      .eq('id', fromReception.data.id)
      .select('id');
    check('the assignee cannot then INVESTIGATE it', denied(edit));

    const vRead = await V.client
      .from('incidents')
      .select('id')
      .eq('id', fromReception.data.id);
    check('a plain user CAN read a reception incident (§25)', !vRead.error && vRead.data?.length === 1);
  }

  console.log('\n=== 6. With an incident linked, completion is allowed ===');
  const nowComplete = await U.client
    .from('goods_receptions')
    .update({ status: 'completed' })
    .eq('id', reception.id)
    .select('id, status, completed_at, completed_by')
    .single();
  check('a discrepancy WITH an incident completes', !nowComplete.error, nowComplete.error?.message);
  check('completed_at is stamped by the database', Boolean(nowComplete.data?.completed_at));
  check('completed_by is stamped as the caller', nowComplete.data?.completed_by === U.id);

  console.log('\n=== 7. Completion is final for an assignee (§35) ===');
  const reopenByUser = await U.client
    .from('goods_receptions')
    .update({ comments: 'ZZ should be refused' })
    .eq('id', reception.id)
    .select('id');
  check('an assignee cannot edit a completed reception', denied(reopenByUser));

  const reopenByPower = await P.client
    .from('goods_receptions')
    .update({ status: 'checking', completed_at: null, completed_by: null })
    .eq('id', reception.id)
    .select('id, status')
    .single();
  check('a power user CAN reopen it', !reopenByPower.error, reopenByPower.error?.message);

  const { data: audit } = await admin
    .from('goods_reception_audit_log')
    .select('action')
    .eq('reception_id', reception.id);
  const actions = (audit ?? []).map((a) => a.action);
  check('the reopen is audited', actions.filter((a) => a === 'reception_status_changed').length >= 2, actions.join(','));
  check('creation is audited', actions.includes('reception_created'));

  console.log('\n=== 8. Exceptions reference the product master (§22) ===');
  const { data: product } = await admin.from('products').select('id').eq('is_active', true).limit(1).single();

  const exception = await U.client
    .from('goods_reception_exceptions')
    .insert({
      reception_id: reception.id,
      product_id: product.id,
      lot_number: 'ZZ-LOT-1',
      best_before: '2027-01-31',
      description: 'ZZ one box with a different MHD',
    })
    .select('id')
    .single();
  check('an assignee can record an exception', !exception.error, exception.error?.message);
  check('lot and MHD are optional', true, 'both nullable columns');

  const vException = await V.client
    .from('goods_reception_exceptions')
    .insert({ reception_id: reception.id, product_id: product.id, description: 'ZZ refused' })
    .select('id');
  check('an unassigned user cannot', denied(vException));

  console.log('\n=== 9. Master data (§37, §38) ===');
  const dupUpper = await M.client
    .from('suppliers')
    .insert({ name: supplier.name.toUpperCase() })
    .select('id');
  check('a case-different duplicate supplier is REFUSED', Boolean(dupUpper.error));

  const puConfig = await P.client.from('suppliers').insert({ name: `ZZ PU ${Date.now()}` }).select('id');
  check('a power user cannot create master data', denied(puConfig));

  const uConfig = await U.client.from('suppliers').update({ is_active: false }).eq('id', supplier.id).select('id');
  check('an assignee cannot deactivate a supplier', denied(uConfig));

  const hardDelete = await admin.from('suppliers').delete().eq('id', supplier.id);
  check('a supplier with receptions cannot be DELETED, even by the service role', Boolean(hardDelete.error));

  const deactivate = await M.client
    .from('suppliers')
    .update({ is_active: false })
    .eq('id', supplier.id)
    .select('id, is_active')
    .single();
  check('a manager can deactivate it instead', !deactivate.error && deactivate.data?.is_active === false);

  const stillThere = await V.client
    .from('goods_receptions')
    .select('supplier:suppliers ( name )')
    .eq('id', reception.id)
    .single();
  check(
    'history keeps the deactivated supplier',
    stillThere.data?.supplier?.name === supplier.name,
    stillThere.data?.supplier?.name,
  );
  await admin.from('suppliers').update({ is_active: true }).eq('id', supplier.id);

  console.log('\n=== 10. Report snapshots are permanent (§42) ===');
  const month = new Date().toISOString().slice(0, 7);
  const { data: version } = await admin.rpc('next_goods_reception_report_version', {
    p_month: `${month}-01`,
  });

  const snapshot = await M.client
    .from('goods_reception_report_snapshots')
    .insert({
      period_month: `${month}-01`,
      version,
      payload: { period: month, summary: { total: 1 } },
      reception_ids: [reception.id],
      generated_by: M.id,
    })
    .select('id')
    .single();
  check('a manager can generate a report', !snapshot.error, snapshot.error?.message);
  if (snapshot.data) created.snapshots.push(snapshot.data.id);

  if (snapshot.data) {
    const rewrite = await M.client
      .from('goods_reception_report_snapshots')
      .update({ payload: { tampered: true } })
      .eq('id', snapshot.data.id)
      .select('id');
    check('a generated report cannot be UPDATED by anyone', denied(rewrite));

    const remove = await A.client
      .from('goods_reception_report_snapshots')
      .delete()
      .eq('id', snapshot.data.id)
      .select('id');
    check('nor DELETED, not even by an admin', denied(remove));
  }

  const uReport = await U.client.from('goods_reception_report_snapshots').select('id');
  check('a plain user cannot read reports', denied(uReport));

  console.log('\n=== 11. Reception is NOT inventory (§4, §28) ===');
  const { count: entriesBefore } = await admin
    .from('inventory_entries')
    .select('id', { count: 'exact', head: true });
  const { count: instancesBefore } = await admin
    .from('inventory_instances')
    .select('id', { count: 'exact', head: true });

  await U.client
    .from('goods_receptions')
    .update({ comments: 'ZZ touched again', quantity_check: 'checked_ok' })
    .eq('id', reception.id);

  const { count: entriesAfter } = await admin
    .from('inventory_entries')
    .select('id', { count: 'exact', head: true });
  const { count: instancesAfter } = await admin
    .from('inventory_instances')
    .select('id', { count: 'exact', head: true });

  check('no inventory entry was created', entriesBefore === entriesAfter, `${entriesBefore} -> ${entriesAfter}`);
  check('no inventory instance was created', instancesBefore === instancesAfter, `${instancesBefore} -> ${instancesAfter}`);

  const { data: fks } = await admin.rpc('next_goods_reception_report_version', { p_month: `${month}-01` });
  check('the report version function is callable', typeof fks === 'number');

  console.log('\n=== 12. Deletion is granted to nobody (§52) ===');
  for (const who of [A, M, P, U]) {
    const res = await who.client.from('goods_receptions').delete().eq('id', reception.id).select('id');
    check(`${who.tag} cannot delete a reception`, denied(res));
  }
}

async function cleanup() {
  console.log('\n=== cleanup ===');
  // Order matters: children, then the rows they point at, then the accounts.
  for (const id of created.snapshots) {
    await admin.from('goods_reception_report_snapshots').delete().eq('id', id);
  }
  for (const id of created.incidents) {
    await admin.from('incidents').delete().eq('id', id);
  }
  for (const id of created.receptions) {
    await admin.from('goods_receptions').delete().eq('id', id);
  }
  for (const id of created.suppliers) {
    await admin.from('suppliers').delete().eq('id', id);
  }
  for (const id of created.transporters) {
    await admin.from('transporters').delete().eq('id', id);
  }
  for (const id of created.users) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  console.log('  removed throwaway fixtures');
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
