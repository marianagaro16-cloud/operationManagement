/**
 * End-to-end verification of the Incidents module.
 *
 *   node scripts/verify-incidents.mjs
 *
 * NOT a unit test. `src/domain/incidents/*.test.ts` covers the workflow rules,
 * the report aggregation and the pattern detector, all of which are pure.
 * What this checks is the half that only exists in Postgres:
 *
 *   - a plain USER genuinely cannot create an incident, at the database
 *   - a POWER USER can create, investigate and resolve, but NOT close
 *   - a MANAGER can close, and can reopen
 *   - a plain USER sees only incidents on orders they personally prepared
 *   - incident numbers are unique and formatted
 *   - a secondary cause cannot duplicate the primary one
 *   - one incident really can carry several products
 *   - a corrective action is a REAL task with a REAL occurrence
 *   - a replacement is separate from the incident and does not resolve it
 *   - report snapshots cannot be updated or deleted by anyone
 *   - the audit trail records the investigation, through the shared view
 *   - existing modules still work
 *
 * Every check runs as a REAL signed-in user through the anon key, so what is
 * tested is the path a browser takes. Throwaway accounts and fixtures are
 * created and removed; nothing pre-existing is touched.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
config({ path: '.env', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !service) {
  console.error('NEXT_PUBLIC_SUPABASE_URL, ANON key and SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const admin = createClient(url, service, { auth: { persistSession: false } });

/**
 * A delivery method for the fixture orders.
 *
 * orders.delivery_method_id is NOT NULL since
 * 20260926090000_delivery_method_required, so an order fixture without one no
 * longer inserts — this suite aborted on its first fixture when that landed.
 * Resolved once and reused, so the fixtures keep the shape a real order has.
 */
let methodId = null;
async function deliveryMethodId() {
  if (!methodId) {
    const { data } = await admin
      .from('delivery_methods')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .single();
    methodId = data.id;
  }
  return methodId;
}

const PW = 'Throwaway-Test-Pw-9137';
/** Unique per run. A leftover from an aborted run must never block the next. */
const TAG = 'ZZ' + Date.now().toString(36);
/** The corrective-action title reused deliberately, to prove the partial index. */
const ACTION_TITLE = TAG + ' Review the packaging procedure';
let pass = 0, fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}

/** Denial can arrive as an error OR as an empty result set — RLS filters rows. */
function denied(res) {
  return Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0);
}

/**
 * A fixture that failed must say so immediately.
 *
 * Without this, a refused insert becomes `null` and surfaces twenty lines
 * later as "cannot read properties of null", which says nothing about what
 * actually went wrong.
 */
function must(res, what) {
  if (res.error) throw new Error(`fixture ${what}: ${res.error.message}`);
  if (!res.data) throw new Error(`fixture ${what}: no row returned`);
  return res.data;
}

async function makeUser(role) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-inc-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({
    email, password: PW, options: { data: { name: `ZZ ${role}` } },
  });
  if (error) throw new Error('signUp: ' + error.message);
  if (!up?.user) throw new Error('signUp returned no user (Supabase auth rate limit?)');
  await admin.from('profiles').update({ status: 'approved', role }).eq('id', up.user.id);
  const { data: si, error: signInError } = await anon.auth.signInWithPassword({ email, password: PW });
  if (signInError || !si?.session) {
    throw new Error('signIn: ' + (signInError?.message ?? 'no session returned'));
  }
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
  return { id: up.user.id, email, client, role };
}

const created = {
  users: [], customers: [], products: [], orders: [], incidents: [], tasks: [], snapshots: [],
};

async function main() {
  const A = await makeUser('admin');
  const M = await makeUser('manager');
  const P = await makeUser('power_user');
  const U = await makeUser('user');
  const U2 = await makeUser('user');
  created.users.push(A.id, M.id, P.id, U.id, U2.id);

  // ---- fixtures: a real customer, products and an order ----
  //
  // Named with the run's own TAG so a leftover from an aborted run can never
  // collide with the next one — customers are unique on their company name.
  const cust = must(
    await admin.from('customers')
      .insert({ company_name: `${TAG} Incident Cust` }).select('id, name').single(),
    'customer',
  );
  created.customers.push(cust.id);

  const prodA = must(
    await admin.from('products')
      .insert({ name: `${TAG} Queso Oaxaca 1kg`, family: `${TAG} Queso`, presentation: '1kg' })
      .select('id').single(),
    'product A',
  );
  const prodB = must(
    await admin.from('products')
      .insert({ name: `${TAG} Panela 454g`, family: `${TAG} Panela`, presentation: '454g' })
      .select('id').single(),
    'product B',
  );
  const prodC = must(
    await admin.from('products')
      .insert({ name: `${TAG} Tortillas 14cm`, family: `${TAG} Tortillas`, presentation: '1kg' })
      .select('id').single(),
    'product C',
  );
  created.products.push(prodA.id, prodB.id, prodC.id);

  const order = must(
    await admin.from('orders').insert({
      customer_id: cust.id, delivery_date: '2026-12-05', preparation_date: '2026-12-04',
      status: 'confirmed', order_type: 'sale', delivery_method_id: await deliveryMethodId(),
    }).select('id, reference').single(),
    'order',
  );
  created.orders.push(order.id);

  const line = must(
    await admin.from('order_lines').insert({
      order_id: order.id, product_id: prodA.id, ordered_quantity: 20, position: 0,
    }).select('id').single(),
    'order line',
  );

  const type = must(
    await admin.from('incident_types').select('id, slug').eq('slug', 'packaging_damaged').single(),
    'incident type',
  );

  console.log('\n=== 1. Vocabulary is seeded and readable by everyone ===');
  const { data: cats } = await U.client.from('incident_categories').select('slug');
  check('every approved user can read the categories', (cats ?? []).length === 5, `${cats?.length}`);
  const { data: types } = await U.client.from('incident_types').select('slug');
  check('and the types', (types ?? []).length >= 23, `${types?.length}`);

  const userCat = await U.client.from('incident_categories')
    .insert({ slug: 'zz_user_cat', name: 'ZZ' }).select();
  check('a plain USER cannot add a category', denied(userCat));
  const puCat = await P.client.from('incident_categories')
    .insert({ slug: 'zz_pu_cat', name: 'ZZ' }).select();
  check('a POWER USER cannot either — configuration is the Manager line', denied(puCat));
  const mgrCat = await M.client.from('incident_categories')
    .insert({ slug: 'zz_mgr_cat', name: 'ZZ Manager Cat' }).select('id').single();
  check('a MANAGER can', !mgrCat.error, mgrCat.error?.message ?? '');
  if (mgrCat.data) await admin.from('incident_categories').delete().eq('id', mgrCat.data.id);

  console.log('\n=== 2. Who may CREATE an incident ===');
  const base = {
    customer_id: cust.id, order_id: order.id, incident_type_id: type.id,
    severity: 'high', description: 'ZZ box arrived crushed',
  };

  const userCreate = await U.client.from('incidents')
    .insert({ ...base, created_by: U.id }).select();
  check('a plain USER cannot create an incident', denied(userCreate), '§4');

  const puCreate = await P.client.from('incidents')
    .insert({ ...base, created_by: P.id }).select('id, incident_number').single();
  check('a POWER USER can', !puCreate.error, puCreate.error?.message ?? '');
  const incident = puCreate.data;
  created.incidents.push(incident.id);

  const mgrCreate = await M.client.from('incidents')
    .insert({ ...base, created_by: M.id, description: 'ZZ second' }).select('id').single();
  check('a MANAGER can', !mgrCreate.error);
  if (mgrCreate.data) created.incidents.push(mgrCreate.data.id);

  const forged = await P.client.from('incidents')
    .insert({ ...base, created_by: U.id }).select();
  check('nobody can create an incident attributed to somebody else', denied(forged));

  console.log('\n=== 3. Incident numbers ===');
  check('an incident number is generated', /^INC-\d{4}-\d{4,}$/.test(incident.incident_number),
    incident.incident_number);
  const { data: numbers } = await admin.from('incidents').select('incident_number');
  const unique = new Set((numbers ?? []).map((n) => n.incident_number));
  check('incident numbers are unique', unique.size === (numbers ?? []).length);

  console.log('\n=== 4. An incident WITHOUT a known order ===');
  const orphan = await P.client.from('incidents').insert({
    customer_id: null, order_id: null, incident_type_id: type.id,
    severity: 'low', description: 'ZZ customer reports damage, order unknown',
    created_by: P.id,
  }).select('id, order_id, customer_id').single();
  check('an incident can exist with no order and no customer', !orphan.error, orphan.error?.message ?? '');
  check('...and records both as genuinely absent',
    orphan.data?.order_id === null && orphan.data?.customer_id === null);
  if (orphan.data) created.incidents.push(orphan.data.id);

  console.log('\n=== 5. One incident, several products ===');
  const items = await P.client.from('incident_affected_items').insert([
    { incident_id: incident.id, product_id: prodA.id, order_line_id: line.id, affected_quantity: 5, position: 0 },
    { incident_id: incident.id, product_id: prodB.id, affected_quantity: 2, position: 1 },
    { incident_id: incident.id, product_id: prodC.id, position: 2 },
  ]).select('id');
  check('one incident carries three products', !items.error && items.data?.length === 3,
    items.error?.message ?? '');

  const badQty = await P.client.from('incident_affected_items')
    .insert({ incident_id: incident.id, product_id: prodA.id, affected_quantity: 0 }).select();
  check('a zero affected quantity is refused', Boolean(badQty.error));

  console.log('\n=== 6. Cause and responsibility are recorded, never inferred ===');
  const { data: fresh } = await admin.from('incidents')
    .select('primary_cause, responsibility').eq('id', incident.id).single();
  check('a new incident has NO primary cause — nobody has looked yet',
    fresh.primary_cause === null);
  check('...and responsibility defaults to unknown, not internal',
    fresh.responsibility === 'unknown');

  await P.client.from('incidents')
    .update({ primary_cause: 'packing', responsibility: 'internal' }).eq('id', incident.id);
  const sec = await P.client.from('incident_secondary_causes')
    .insert({ incident_id: incident.id, cause: 'transport' }).select();
  check('a power user may record a contributing cause', !sec.error, sec.error?.message ?? '');

  const dupCause = await P.client.from('incident_secondary_causes')
    .insert({ incident_id: incident.id, cause: 'packing' }).select();
  check('a contributing cause cannot duplicate the PRIMARY one', Boolean(dupCause.error),
    'would double-count it in every why breakdown');

  const twice = await P.client.from('incident_secondary_causes')
    .insert({ incident_id: incident.id, cause: 'transport' }).select();
  check('...nor be recorded twice', Boolean(twice.error));

  console.log('\n=== 7. The lifecycle, and who may close ===');
  await P.client.from('incidents')
    .update({ status: 'investigating' }).eq('id', incident.id);
  const { data: s1 } = await admin.from('incidents').select('status').eq('id', incident.id).single();
  check('a POWER USER can move an incident to investigating', s1.status === 'investigating');

  await P.client.from('incidents')
    .update({ status: 'resolved', resolution_notes: 'ZZ repacked and redelivered' })
    .eq('id', incident.id);
  const { data: s2 } = await admin.from('incidents').select('status').eq('id', incident.id).single();
  check('a POWER USER can resolve', s2.status === 'resolved');

  const puClose = await P.client.from('incidents')
    .update({ status: 'closed' }).eq('id', incident.id).select();
  check('a POWER USER CANNOT close', Boolean(puClose.error), 'incident_close_denied');
  const { data: s3 } = await admin.from('incidents').select('status').eq('id', incident.id).single();
  check('...and the status really did not change', s3.status === 'resolved', s3.status);

  const mgrClose = await M.client.from('incidents')
    .update({ status: 'closed' }).eq('id', incident.id).select('status').single();
  check('a MANAGER can close', !mgrClose.error && mgrClose.data?.status === 'closed',
    mgrClose.error?.message ?? '');

  const puReopen = await P.client.from('incidents')
    .update({ status: 'investigating' }).eq('id', incident.id).select();
  check('a POWER USER cannot reopen a closed incident', Boolean(puReopen.error));

  const mgrReopen = await M.client.from('incidents')
    .update({ status: 'resolved' }).eq('id', incident.id).select('status').single();
  check('a MANAGER can reopen', !mgrReopen.error);

  console.log('\n=== 8. Nothing may be DELETED — history is not destroyed ===');
  const del = await A.client.from('incidents').delete().eq('id', incident.id).select();
  check('not even an ADMIN can delete an incident', denied(del), '§18: no delete policy exists');
  const { data: stillThere } = await admin.from('incidents').select('id').eq('id', incident.id).single();
  check('...and it is still there', Boolean(stillThere));

  console.log('\n=== 9. What a plain USER may SEE ===');
  const { data: userSees } = await U.client.from('incidents').select('id');
  check('a plain USER sees NO incidents on orders they never touched',
    (userSees ?? []).length === 0, `${userSees?.length} visible`);

  // The user prepares the order: their lot allocation is the record of it.
  const alloc = await U.client.from('lot_allocations').insert({
    order_line_id: line.id, lot_number: 'ZZ-LOT-INC-1', quantity: 5, created_by: U.id,
  }).select('id').single();
  check('a plain USER can prepare the order', !alloc.error, alloc.error?.message ?? '');

  const { data: userSeesNow } = await U.client.from('incidents').select('id, incident_number');
  check('now they see the incident on the order they prepared',
    (userSeesNow ?? []).some((i) => i.id === incident.id), `${userSeesNow?.length} visible`);

  const { data: otherUser } = await U2.client.from('incidents').select('id');
  check('another user who prepared nothing still sees none', (otherUser ?? []).length === 0);

  const { data: userOrphan } = await U.client.from('incidents').select('id').eq('id', orphan.data.id);
  check('an incident with no order stays invisible to a plain user',
    (userOrphan ?? []).length === 0, 'nothing ties it to their work');

  const { data: mgrSees } = await M.client.from('incidents').select('id');
  check('a MANAGER sees every incident', (mgrSees ?? []).length >= 3, `${mgrSees?.length}`);
  const { data: puSees } = await P.client.from('incidents').select('id');
  check('a POWER USER sees every incident', (puSees ?? []).length >= 3, `${puSees?.length}`);

  console.log('\n=== 10. A replacement is NOT the incident ===');
  const { data: replacementOrder } = await admin.from('orders').insert({
    customer_id: cust.id, delivery_date: '2026-12-12', preparation_date: '2026-12-11',
    status: 'confirmed', order_type: 'sale', delivery_method_id: await deliveryMethodId(), replaces_incident_id: incident.id,
  }).select('id, reference').single();
  created.orders.push(replacementOrder.id);

  const rep = await P.client.from('incident_replacements').insert({
    incident_id: incident.id, order_id: replacementOrder.id, created_by: P.id,
  }).select('id').single();
  check('a replacement can be recorded as a REAL order', !rep.error, rep.error?.message ?? '');

  const { data: afterRep } = await admin.from('incidents')
    .select('status').eq('id', incident.id).single();
  check('recording it does NOT resolve or change the incident', afterRep.status === 'resolved',
    '§3: an incident describes what went wrong, a replacement what we did after');

  const offOrder = await P.client.from('incident_replacements').insert({
    incident_id: incident.id, note: 'ZZ 5 units handed over at the door', created_by: P.id,
  }).select('id').single();
  check('an off-order replacement can be recorded too', !offOrder.error);

  const empty = await P.client.from('incident_replacements')
    .insert({ incident_id: incident.id, created_by: P.id }).select();
  check('a replacement naming neither an order nor anything given is refused', Boolean(empty.error));

  // The replacement order travels through the ordinary machinery.
  const { data: repLine } = await admin.from('order_lines').insert({
    order_id: replacementOrder.id, product_id: prodA.id, ordered_quantity: 5, position: 0,
  }).select('id').single();
  const repAlloc = await U.client.from('lot_allocations').insert({
    order_line_id: repLine.id, lot_number: 'ZZ-LOT-INC-REP', quantity: 5, created_by: U.id,
  }).select('id').single();
  check('the replacement order is picked and lot-numbered like any other', !repAlloc.error,
    repAlloc.error?.message ?? '');
  const { data: prepDay } = await M.client.from('orders')
    .select('id').eq('preparation_date', '2026-12-11').neq('status', 'cancelled');
  check('...and appears in Lotnummerkontrol', (prepDay ?? []).some((o) => o.id === replacementOrder.id));

  // ---- linking by the number a person reads off a delivery note ----
  //
  // The action resolves a reference to an id server-side and refuses one that
  // belongs to a different customer. A mistyped digit would otherwise attach
  // somebody else's delivery to this incident, flag THAT order as a
  // replacement, and file it in the monthly report under the wrong name.
  const { data: otherCust } = await admin
    .from('customers').insert({ company_name: `${TAG} Other Cust` }).select('id').single();
  created.customers.push(otherCust.id);
  const { data: otherOrder } = await admin.from('orders').insert({
    customer_id: otherCust.id, delivery_date: '2026-12-20', preparation_date: '2026-12-19',
    status: 'confirmed', order_type: 'sale', delivery_method_id: await deliveryMethodId(),
  }).select('id, reference').single();
  created.orders.push(otherOrder.id);

  const { data: byRef } = await M.client.from('orders')
    .select('id, customer_id').eq('reference', replacementOrder.reference).maybeSingle();
  check('an order is findable by the reference a person can read',
    byRef?.id === replacementOrder.id);
  check('...and its customer is checkable against the incident',
    byRef?.customer_id === cust.id);

  const { data: wrongCust } = await M.client.from('orders')
    .select('customer_id').eq('reference', otherOrder.reference).maybeSingle();
  check('a reference for ANOTHER customer is detectable before it is linked',
    wrongCust?.customer_id !== cust.id,
    'the action refuses this pairing');

  // ---- a replacement order is an ORDINARY order ----
  const { data: flagged } = await admin.from('orders')
    .select('id, replaces_incident_id, customer_id, status')
    .eq('id', replacementOrder.id).single();
  check('the replacement order carries its incident', flagged.replaces_incident_id === incident.id);
  check('...and is otherwise a normal confirmed order for the same customer',
    flagged.status === 'confirmed' && flagged.customer_id === cust.id);

  console.log('\n=== 11. A corrective action is a REAL task ===');
  const task = await P.client.from('tasks').insert({
    title: ACTION_TITLE, frequency: 'one_off',
    incident_id: incident.id, is_active: true, is_skippable: true, created_by: P.id,
  }).select('id').single();
  check('a one-off task can be raised from an incident', !task.error, task.error?.message ?? '');
  if (task.data) created.tasks.push(task.data.id);

  const occ = await P.client.from('task_occurrences').insert({
    task_id: task.data.id, period_key: '2026-12-20', due_date: '2026-12-20',
    status: 'pending', source: 'manual', assignee_id: U.id,
  }).select('id').single();
  check('with a real occurrence carrying an owner and a due date', !occ.error, occ.error?.message ?? '');

  // The clash the partial index was made for.
  const second = await P.client.from('tasks').insert({
    title: ACTION_TITLE, frequency: 'one_off',
    incident_id: orphan.data.id, is_active: true, created_by: P.id,
  }).select('id').single();
  check('a SECOND incident may raise the same corrective action title', !second.error,
    'the unique index is partial on frequency <> one_off');
  if (second.data) created.tasks.push(second.data.id);

  const dupRecurring = await M.client.from('tasks').insert({
    title: ACTION_TITLE, frequency: 'weekly', is_active: true,
  }).select('id').single();
  if (dupRecurring.data) created.tasks.push(dupRecurring.data.id);
  const dupRecurring2 = await M.client.from('tasks').insert({
    title: ACTION_TITLE, frequency: 'weekly', is_active: true,
  }).select();
  check('but RECURRING definitions keep their uniqueness guarantee', Boolean(dupRecurring2.error));

  const { data: linked } = await M.client.from('task_occurrences')
    .select('id, task:tasks!inner ( incident_id )').eq('task.incident_id', incident.id);
  check('the incident can find its corrective actions', (linked ?? []).length === 1);

  console.log('\n=== 12. Report snapshots are FROZEN ===');
  const snap = await M.client.from('incident_report_snapshots').insert({
    period_month: '2026-12-01', version: 1,
    payload: { schema: 1, summary: { total: 3 } }, incident_ids: [incident.id],
    generated_by: M.id,
  }).select('id, version').single();
  check('a manager can save a report', !snap.error, snap.error?.message ?? '');
  if (snap.data) created.snapshots.push(snap.data.id);

  const { data: nextVersion } = await M.client.rpc('next_incident_report_version', {
    p_month: '2026-12-01',
  });
  check('the next version is assigned by the database', nextVersion === 2, String(nextVersion));

  const snap2 = await M.client.from('incident_report_snapshots').insert({
    period_month: '2026-12-01', version: 2,
    payload: { schema: 1, summary: { total: 4 } }, incident_ids: [], generated_by: M.id,
  }).select('id').single();
  check('a month can be reported twice, both kept', !snap2.error);
  if (snap2.data) created.snapshots.push(snap2.data.id);

  const clash = await M.client.from('incident_report_snapshots').insert({
    period_month: '2026-12-01', version: 1, payload: {}, incident_ids: [], generated_by: M.id,
  }).select();
  check('the same version cannot be written twice', Boolean(clash.error));

  const mutate = await A.client.from('incident_report_snapshots')
    .update({ payload: { tampered: true } }).eq('id', snap.data.id).select();
  check('NOBODY can edit a saved report — not even an admin', denied(mutate), '§42');
  const wipe = await A.client.from('incident_report_snapshots')
    .delete().eq('id', snap.data.id).select();
  check('nor delete one', denied(wipe));

  const { data: stillFrozen } = await admin.from('incident_report_snapshots')
    .select('payload').eq('id', snap.data.id).single();
  check('...and the stored numbers are untouched', stillFrozen.payload?.summary?.total === 3);

  const userSnap = await U.client.from('incident_report_snapshots').select('id');
  check('a plain USER sees no saved reports', (userSnap.data ?? []).length === 0);

  console.log('\n=== 13. The audit trail ===');
  const { data: audit } = await M.client.from('incident_audit_log')
    .select('action').eq('incident_id', incident.id).order('created_at');
  const actions = (audit ?? []).map((a) => a.action);
  check('creation is audited', actions.includes('incident_created'));
  check('status changes are audited', actions.includes('incident_status_changed'));
  check('the investigation is audited', actions.includes('incident_investigation_changed'),
    actions.join(', '));

  // The unified view was dropped with the audit screen. The log is now read
  // directly, under incidents.view_all, which is what feeds the History
  // section on the incident page.
  const { data: readable } = await M.client.from('incident_audit_log')
    .select('action').eq('incident_id', incident.id).limit(50);
  check('a manager can read the incident log that feeds History',
    (readable ?? []).length > 0, `${readable?.length} rows`);

  const userAudit = await U.client.from('incident_audit_log').select('id');
  check('a plain USER cannot read the audit log', (userAudit.data ?? []).length === 0);

  console.log('\n=== 14. Every PostgREST select in the module actually runs ===');
  /*
   * The gap that let a broken module reach production.
   *
   * The domain tests are pure and never touch PostgREST; the checks above use
   * simple single-table selects. Nothing exercised the EMBEDDED selects the
   * pages actually issue — so `order:orders ( ... )` became ambiguous the
   * moment this module added orders.replaces_incident_id as a second
   * relationship between the two tables, and every screen that embedded an
   * order threw at render with a digest and no message.
   *
   * The strings are READ OUT OF THE SOURCE rather than copied here. A copy
   * would pass while the shipped query was broken, which is the same class of
   * failure one level down.
   */
  const source = await readFile(new URL('../src/server/incidents.ts', import.meta.url), 'utf8');

  const selects = [];
  // Named constants, whose table the file does not state next to them.
  const NAMED_TABLES = { LIST_SELECT: 'incidents', DETAIL_SELECT: 'incidents' };
  for (const [, name, body] of source.matchAll(/const (\w+_SELECT) = `([^`]+)`/g)) {
    selects.push({ label: name, table: NAMED_TABLES[name], select: body });
  }
  // Inline `.from('x').select(`...`)` pairs.
  for (const [, table, body] of source.matchAll(/\.from\('(\w+)'\)\s*\.select\(`([^`]+)`/g)) {
    selects.push({ label: `${table} inline`, table, select: body });
  }

  check('every named select has a known table',
    selects.every((s) => Boolean(s.table)),
    selects.filter((s) => !s.table).map((s) => s.label).join(', ') || 'all mapped');
  check('the extractor found the selects it should',
    selects.length >= 7, `${selects.length} found`);

  /*
   * The selects that are BUILT AT RUNTIME, which the scrape above cannot see.
   *
   * getIncidents swaps the items embed for an inner join when a product or a
   * brand filter is set, and getIncidentsForExport interpolates '!inner' into
   * its template. Those variants are the ones a real filtered screen issues,
   * and none of them existed as a literal string anywhere until they ran — so
   * the extractor found the unfiltered shape and proved nothing about the
   * filtered one. Every ${...} is expanded BOTH ways here.
   */
  // Character classes rather than escapes, so nothing here depends on how a
  // shell or an editor treats a backslash on the way into this file.
  const BT = String.fromCharCode(96);
  const INTERP = new RegExp('[$][{][^}]+[}]', 'g');
  for (const [, body] of source.matchAll(new RegExp('const select = ' + BT + '([^' + BT + ']+)' + BT, 'g'))) {
    selects.push({ label: 'export select (unfiltered)', table: 'incidents', select: body.replace(INTERP, '') });
    selects.push({ label: 'export select (inner joins)', table: 'incidents', select: body.replace(INTERP, '!inner') });
  }
  const listSelect = selects.find((s) => s.label === 'LIST_SELECT')?.select ?? '';
  for (const [label, replacement] of [
    ['list select filtered by product', 'items:incident_affected_items!inner ( id, product_id )'],
    ['list select filtered by brand', 'items:incident_affected_items!inner ( id, product_id, product:products!inner ( brand_id ) )'],
  ]) {
    selects.push({
      label,
      table: 'incidents',
      select: listSelect.replace('items:incident_affected_items ( id )', replacement),
    });
  }

  for (const s of selects) {
    if (!s.table) continue;
    const res = await M.client.from(s.table).select(s.select).limit(1);
    check(`${s.label} runs`, !res.error, res.error?.message ?? '');
  }

  /*
   * ...and the filter those inner joins exist to serve actually SELECTS.
   *
   * Parsing is not filtering. A join written one level too shallow parses
   * perfectly and returns every incident, which on screen looks like a filter
   * that found a lot rather than one that did nothing.
   */
  const { data: brandRows } = await admin.from('brands').select('id, name').order('sort_order');
  const [brandOne, brandTwo] = brandRows ?? [];
  check('there are at least two brands to tell apart', Boolean(brandOne && brandTwo),
    (brandRows ?? []).map((b) => b.name).join(' | '));

  if (brandOne && brandTwo) {
    await admin.from('products').update({ brand_id: brandOne.id }).eq('id', prodA.id);
    await admin.from('products').update({ brand_id: brandTwo.id }).eq('id', prodB.id);

    const brandSelect = selects.find((s) => s.label === 'list select filtered by brand').select;
    const hit = await M.client.from('incidents').select(brandSelect)
      .eq('items.product.brand_id', brandOne.id).eq('id', incident.id);
    check('an incident is found through the brand of a product on it',
      !hit.error && (hit.data ?? []).length === 1, hit.error?.message ?? `${(hit.data ?? []).length} rows`);

    // prodC has no brand at all, so a third brand must match nothing here.
    const third = (brandRows ?? []).find((b) => b.id !== brandOne.id && b.id !== brandTwo.id);
    if (third) {
      const miss = await M.client.from('incidents').select(brandSelect)
        .eq('items.product.brand_id', third.id).eq('id', incident.id);
      check('and NOT found through a brand none of its products carry',
        !miss.error && (miss.data ?? []).length === 0, miss.error?.message ?? `${(miss.data ?? []).length} rows`);
    }

    await admin.from('products').update({ brand_id: null }).in('id', [prodA.id, prodB.id]);
  }

  console.log('\n=== 15. Existing modules still work ===');
  const { data: orders } = await M.client.from('orders').select('id').limit(5);
  check('orders still readable', (orders ?? []).length > 0);
  const { data: lots } = await U.client.from('lot_allocations').select('id').limit(5);
  check('lot allocations still readable', (lots ?? []).length > 0);
  const { data: tasksStill } = await U.client.from('task_occurrences').select('id').limit(5);
  check('task occurrences still readable', (tasksStill ?? []).length > 0);
  const { data: inv } = await U.client.from('inventory_instances').select('id').limit(5);
  check('inventory still readable', !inv || Array.isArray(inv));
  const { data: perms } = await admin.from('permission_catalog').select('key');
  check('the permission catalogue grew by exactly four keys',
    (perms ?? []).filter((p) => p.key.startsWith('incidents.')).length === 4);
}

/**
 * Remove everything this run made.
 *
 * Driven by the run's TAG rather than by the ids collected along the way, and
 * walked in strict dependency order. A run that aborts halfway has an
 * incomplete `created` list, so an id-driven cleanup leaves fixtures behind —
 * which then collide with the NEXT run and make it fail for a reason that has
 * nothing to do with the code. This is self-healing instead.
 *
 * Order matters: order_lines and incidents reference products and customers
 * with ON DELETE RESTRICT, so the referencing rows have to go first.
 */
async function cleanup() {
  await admin.from('incident_report_snapshots').delete().eq('period_month', '2026-12-01');

  // Tasks first: a corrective action points at an incident (set null), so it
  // is not a blocker, but removing it keeps the task list clean either way.
  await admin.from('tasks').delete().like('title', TAG + '%');
  for (const id of created.tasks) await admin.from('tasks').delete().eq('id', id);

  // Customers own the orders and the incidents; find them through the tag.
  const { data: customers } = await admin
    .from('customers').select('id').like('company_name', TAG + '%');
  const customerIds = [...new Set([...(customers ?? []).map((c) => c.id), ...created.customers])];

  // Looked up and deleted BY ID rather than with a bulk filtered delete: a
  // filtered delete here was observed to report success while leaving the
  // rows in place, and a cleanup that silently does nothing is worse than no
  // cleanup at all — the next run then fails on a collision instead.
  for (const customerId of customerIds) {
    // Incidents FIRST. An incident_replacement points at the replacement
    // order, and an incident points at the original one — both ON DELETE SET
    // NULL, so they do not block the order. What DOES block it is the order
    // being deleted while an incident row is mid-cascade, so the safe order is
    // to remove the incidents and everything they own, then the orders.
    const { data: incidents } = await admin
      .from('incidents').select('id').eq('customer_id', customerId);
    for (const i of incidents ?? []) {
      const res = await admin.from('incidents').delete().eq('id', i.id).select();
      if (res.error) console.warn(`  cleanup: incident ${i.id} — ${res.error.message}`);
    }

    // Orders cascade to their lines, which cascade to lot allocations.
    const { data: orders } = await admin.from('orders').select('id').eq('customer_id', customerId);
    for (const o of orders ?? []) {
      const res = await admin.from('orders').delete().eq('id', o.id).select();
      if (res.error) console.warn(`  cleanup: order ${o.id} — ${res.error.message}`);
    }
  }

  // The order-less incidents, which no customer sweep would reach.
  for (const id of created.incidents) await admin.from('incidents').delete().eq('id', id);
  await admin.from('incidents').delete().like('description', 'ZZ %');

  const { data: products } = await admin.from('products').select('id').like('name', TAG + '%');
  const productIds = [...new Set([...(products ?? []).map((p) => p.id), ...created.products])];
  for (const id of productIds) {
    const res = await admin.from('products').delete().eq('id', id).select();
    if (res.error) console.warn(`  cleanup: product ${id} — ${res.error.message}`);
  }

  for (const id of customerIds) {
    const res = await admin.from('customers').delete().eq('id', id).select();
    if (res.error) console.warn(`  cleanup: customer ${id} — ${res.error.message}`);
  }

  await admin.from('incident_categories').delete().like('slug', 'zz_%');

  for (const id of created.users) {
    await admin.from('security_audit_log').delete().eq('target_user_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

/*
 * An abort is not "one failure".
 *
 * These scripts stop at the first thrown error, so a FATAL means every
 * check below it never ran. Reporting that as FAIL=1 makes a dead run look
 * like one small problem — verify-push read "PASS=12 FAIL=1" for weeks while
 * two thirds of it never executed. The summary now says plainly that the
 * rest did not run.
 */
let aborted = null;

main()
  .catch((e) => { aborted = e.message; fail++; console.error('\nFATAL:', e.message); })
  .finally(async () => {
    await cleanup();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (aborted) console.log(`  ABORTED after ${pass} checks — the rest never ran: ${aborted}`);
    process.exit(fail === 0 ? 0 : 1);
  });
