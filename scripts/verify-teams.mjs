/**
 * End-to-end verification of teams and the production manager role.
 *
 *   node scripts/verify-teams.mjs
 *
 * Like verify-roles.mjs, this checks the half that only exists in Postgres:
 * every assertion runs as a REAL signed-in user through the anon key, the
 * path a browser takes.
 *
 *   - a production manager's team is forced to Producción
 *   - tasks: a plain user sees only their team's, and resolving another
 *     team's task by id is refused; the production manager, like a Power
 *     User, sees and manages every team's
 *   - incidents: the production manager reads all, edits Producción's, and
 *     cannot move one to Operaciones; corrective actions take their
 *     incident's team
 *   - orders are read-only for the production manager, lots included, while a
 *     plain user still records lots
 *   - inventory: the production manager assigns people of either team
 *
 * Throwaway zz- accounts and fixtures are created and removed; nothing
 * pre-existing is changed.
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

const PW = 'Throwaway-Test-Pw-4821';
let pass = 0, fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}

/** Denial can arrive as an error OR as an empty result set — RLS filters rows. */
function denied(res) {
  return Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0);
}

const errorOf = (res) => res.error?.message ?? '';

async function makeUser(label, role, team) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-teams-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({
    email, password: PW, options: { data: { name: `ZZ ${label}` } },
  });
  if (error) throw new Error('signUp: ' + error.message);
  await admin.from('profiles').update({ status: 'approved', role, team }).eq('id', up.user.id);
  const { data: si } = await anon.auth.signInWithPassword({ email, password: PW });
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
  return { id: up.user.id, email, client };
}

const created = {
  users: [], tasks: [], incidents: [], orders: [], customers: [], assignments: [],
};

async function one(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function main() {
  // The production manager is created with team 'operations' on purpose.
  const PM = await makeUser('pm', 'production_manager', 'operations');
  const PROD = await makeUser('prod', 'user', 'production');
  const OPS = await makeUser('ops', 'user', 'operations');
  created.users.push(PM.id, PROD.id, OPS.id);

  console.log('\n=== 1. The role and its team ===');
  const { data: pmRow } = await admin.from('profiles').select('role, team').eq('id', PM.id).single();
  check('a production manager is forced onto Producción', pmRow.team === 'production', pmRow.team);
  const { data: perms } = await admin.from('role_permissions').select('permission').eq('role', 'production_manager');
  const held = new Set((perms ?? []).map((p) => p.permission));
  check('holds inventory, receiving, tasks, incidents, push and reports',
    ['inventory.manage_instances', 'goods_reception.manage_all', 'tasks.manage_occurrences',
      'incidents.manage', 'incidents.view_all', 'notifications.send', 'reports.view', 'reports.export']
      .every((p) => held.has(p)));
  check('holds no order or setup permission',
    !['orders.manage', 'orders.manage_config', 'inventory.manage_templates', 'tasks.manage_definitions',
      'incidents.manage_config', 'goods_reception.manage_config'].some((p) => held.has(p)));

  console.log('\n=== 2. Tasks follow their team ===');
  const today = new Date().toISOString().slice(0, 10);
  const mkTask = async (team) => {
    const task = await one(await admin.from('tasks').insert({
      title: `ZZ ${team} task`, frequency: 'one_off', schedule_config: null, is_active: true, team,
    }).select('id').single(), 'task');
    created.tasks.push(task.id);
    const occ = await one(await admin.from('task_occurrences').insert({
      task_id: task.id, period_key: `zz-${team}`, due_date: today, source: 'manual',
    }).select('id').single(), 'occurrence');
    return { task: task.id, occ: occ.id };
  };
  const prodTask = await mkTask('production');
  const opsTask = await mkTask('operations');

  const sees = async (who, occ) =>
    ((await who.client.from('task_occurrences').select('id').eq('id', occ)).data ?? []).length === 1;
  check('an Operaciones user sees their task', await sees(OPS, opsTask.occ));
  check('an Operaciones user does NOT see a Producción task', !(await sees(OPS, prodTask.occ)));
  check('a Producción user sees their task', await sees(PROD, prodTask.occ));
  check('a Producción user does NOT see an Operaciones task', !(await sees(PROD, opsTask.occ)));
  check('the production manager sees Producción tasks', await sees(PM, prodTask.occ));
  check('the production manager sees Operaciones tasks too', await sees(PM, opsTask.occ));
  const opsReadsTask = await OPS.client.from('tasks').select('id').eq('id', prodTask.task);
  check('the task definition itself is hidden from the other team', denied(opsReadsTask));

  const byId = await OPS.client.rpc('complete_occurrence', { p_occurrence_id: prodTask.occ });
  check('completing another team\'s task by its id is refused', errorOf(byId).includes('not_your_team'), errorOf(byId));
  const pmMove = await PM.client.from('task_occurrences').update({ due_date_override: today }).eq('id', opsTask.occ).select('id');
  check('the production manager can reschedule an Operaciones task', !pmMove.error && pmMove.data.length === 1, errorOf(pmMove));
  const pmOps = await PM.client.rpc('complete_occurrence', { p_occurrence_id: opsTask.occ });
  check('...and complete one', !pmOps.error, errorOf(pmOps));
  const pmAssign = await PM.client.from('task_occurrences').update({ assignee_id: PROD.id }).eq('id', prodTask.occ).select('id');
  check('the production manager can assign a Producción task', !pmAssign.error && pmAssign.data.length === 1, errorOf(pmAssign));
  const prodDone = await PROD.client.rpc('complete_occurrence', { p_occurrence_id: prodTask.occ });
  check('the assignee completes it', !prodDone.error, errorOf(prodDone));

  console.log('\n=== 3. Incidents ===');
  const { data: type } = await admin.from('incident_types').select('id').eq('is_active', true).limit(1).single();
  const mkIncident = async (reporter) => {
    const row = await one(await admin.from('incidents').insert({
      incident_type_id: type.id, description: 'ZZ team check', created_by: reporter.id,
    }).select('id, team').single(), 'incident');
    created.incidents.push(row.id);
    return row;
  };
  const prodInc = await mkIncident(PROD);
  const opsInc = await mkIncident(OPS);
  check('an incident takes its reporter\'s team', prodInc.team === 'production' && opsInc.team === 'operations',
    `${prodInc.team} / ${opsInc.team}`);

  const pmReads = await PM.client.from('incidents').select('id').in('id', [prodInc.id, opsInc.id]);
  check('the production manager reads every incident', (pmReads.data ?? []).length === 2);
  const pmEditsProd = await PM.client.from('incidents').update({ investigation_notes: 'zz' }).eq('id', prodInc.id).select('id');
  check('...edits a Producción incident', !pmEditsProd.error && pmEditsProd.data.length === 1, errorOf(pmEditsProd));
  const pmEditsOps = await PM.client.from('incidents').update({ investigation_notes: 'zz' }).eq('id', opsInc.id).select('id');
  check('...cannot edit an Operaciones incident', denied(pmEditsOps));
  const pmMovesTeam = await PM.client.from('incidents').update({ team: 'operations' }).eq('id', prodInc.id).select('id');
  check('...cannot move a Producción incident to Operaciones', denied(pmMovesTeam));

  const action = await PM.client.from('tasks').insert({
    title: 'ZZ corrective', frequency: 'one_off', incident_id: prodInc.id, team: 'operations',
  }).select('id, team').single();
  if (action.data) created.tasks.push(action.data.id);
  check('a corrective action takes its incident\'s team, whatever was sent',
    !action.error && action.data.team === 'production', errorOf(action) || action.data?.team);
  const actionOps = await PM.client.from('tasks').insert({
    title: 'ZZ corrective', frequency: 'one_off', incident_id: opsInc.id,
  }).select('id');
  if (actionOps.data?.[0]) created.tasks.push(actionOps.data[0].id);
  check('...and cannot be raised on an Operaciones incident', Boolean(actionOps.error));

  console.log('\n=== 4. Orders are read-only for the production manager ===');
  const { data: method } = await admin.from('delivery_methods').select('id').eq('is_active', true).limit(1).single();
  const { data: product } = await admin.from('products').select('id').eq('is_active', true).limit(1).single();
  const customer = await one(await admin.from('customers').insert({ company_name: `ZZ teams ${Date.now()}` }).select('id').single(), 'customer');
  created.customers.push(customer.id);
  const order = await one(await admin.from('orders').insert({
    customer_id: customer.id, delivery_method_id: method.id, status: 'confirmed',
    order_date: today, delivery_date: today, preparation_date: today,
  }).select('id').single(), 'order');
  created.orders.push(order.id);
  const line = await one(await admin.from('order_lines').insert({
    order_id: order.id, product_id: product.id, ordered_quantity: 2, position: 0,
  }).select('id').single(), 'line');

  const pmSeesOrder = await PM.client.from('orders').select('id').eq('id', order.id);
  check('the production manager reads orders', (pmSeesOrder.data ?? []).length === 1);
  const pmLot = await PM.client.from('lot_allocations').insert({
    order_line_id: line.id, lot_number: 'ZZ1', quantity: 1, created_by: PM.id,
  }).select('id');
  check('...cannot record a lot', errorOf(pmLot).includes('orders_read_only'), errorOf(pmLot));
  const pmShort = await PM.client.rpc('set_line_shortfall_reason', { p_order_line_id: line.id, p_reason: 'zz' });
  check('...cannot record a shortfall', errorOf(pmShort).includes('orders_read_only'), errorOf(pmShort));

  const opsLot = await OPS.client.from('lot_allocations').insert({
    order_line_id: line.id, lot_number: 'ZZ1', quantity: 2, created_by: OPS.id,
  }).select('id');
  check('a plain user still records lots', !opsLot.error, errorOf(opsLot));

  // With a real box type and a fully prepared, boxed order, every other rule
  // is satisfied — so a refusal can only be the read-only guard.
  const { data: boxType } = await admin.from('box_types').select('id').eq('is_active', true).limit(1).maybeSingle();
  if (boxType) {
    const pmBoxes = await PM.client.rpc('order_set_box_quantity', { p_order_id: order.id, p_box_type_id: boxType.id, p_quantity: 1 });
    check('...the production manager cannot record boxes', errorOf(pmBoxes).includes('orders_read_only'), errorOf(pmBoxes));
    await one(await admin.from('order_boxes').insert({ order_id: order.id, box_type_id: boxType.id, quantity: 1 }).select('id'), 'boxes');
  }
  const pmReady = await PM.client.rpc('order_set_ready', { p_order_id: order.id, p_ready: true });
  check('the production manager cannot mark it Ready', errorOf(pmReady).includes('orders_read_only'), errorOf(pmReady));
  const { data: after } = await admin.from('orders').select('ready_at').eq('id', order.id).single();
  check('...and it really is not Ready', after.ready_at === null);

  console.log('\n=== 5. Inventory assignments: either team ===');
  const { data: instance } = await admin.from('inventory_instances').select('id').order('inventory_date', { ascending: false }).limit(1).single();
  if (instance) {
    const pmOpsAssign = await PM.client.from('inventory_assignments').insert({ instance_id: instance.id, user_id: OPS.id, assigned_by: PM.id }).select('id');
    if (pmOpsAssign.data?.[0]) created.assignments.push(pmOpsAssign.data[0].id);
    check('the production manager can assign an Operaciones person', !pmOpsAssign.error, errorOf(pmOpsAssign));
    const pmProdAssign = await PM.client.from('inventory_assignments').insert({ instance_id: instance.id, user_id: PROD.id, assigned_by: PM.id }).select('id');
    if (pmProdAssign.data?.[0]) created.assignments.push(pmProdAssign.data[0].id);
    check('...and a Producción person', !pmProdAssign.error, errorOf(pmProdAssign));
  } else {
    console.log('  SKIP  no inventory to assign on');
  }
}

async function cleanup() {
  if (created.assignments.length) await admin.from('inventory_assignments').delete().in('id', created.assignments);
  for (const id of created.orders) {
    const { data: lines } = await admin.from('order_lines').select('id').eq('order_id', id);
    const lineIds = (lines ?? []).map((l) => l.id);
    if (lineIds.length) await admin.from('lot_allocations').delete().in('order_line_id', lineIds);
    await admin.from('order_lines').delete().eq('order_id', id);
    await admin.from('order_boxes').delete().eq('order_id', id);
    await admin.from('orders').delete().eq('id', id);
  }
  if (created.customers.length) await admin.from('customers').delete().in('id', created.customers);
  if (created.tasks.length) {
    await admin.from('task_occurrences').delete().in('task_id', created.tasks);
    await admin.from('tasks').delete().in('id', created.tasks);
  }
  if (created.incidents.length) await admin.from('incidents').delete().in('id', created.incidents);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
}

try {
  await main();
} catch (e) {
  fail++;
  console.error('\nABORTED:', e.message);
} finally {
  await cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
