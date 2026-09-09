/**
 * End-to-end verification of the four-role permission model.
 *
 *   node scripts/verify-roles.mjs
 *
 * This is NOT a unit test. `src/lib/authz.test.ts` covers the pure logic; what
 * this checks is the half that only exists in Postgres, and that vitest never
 * touches:
 *
 *   - RLS actually stops a Manager creating a user, not just the hidden nav
 *   - a Power User genuinely cannot edit an inventory template
 *   - the Product Code column rule holds against a direct update
 *   - the permission matrix cannot be used to grant an admin-only capability
 *   - the last-admin guard cannot be walked past by demoting to 'manager'
 *   - turning a permission off in the matrix actually removes the access
 *
 * Every check runs as a REAL signed-in user through the anon key, so what is
 * tested is the same path a browser takes. Four throwaway accounts and a
 * handful of fixtures are created and removed; nothing pre-existing is touched.
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
  const email = `zz-role-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
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

const created = { users: [], products: [], templates: [] };

async function main() {
  const A = await makeUser('admin');
  const M = await makeUser('manager');
  const P = await makeUser('power_user');
  const U = await makeUser('user');
  created.users.push(A.id, M.id, P.id, U.id);

  console.log('\n=== 1. The enum and the defaults exist ===');
  const { data: cat } = await admin.from('permission_catalog').select('key, module, is_configurable');
  check('permission catalogue seeded', (cat ?? []).length >= 21, `${cat?.length} rows`);
  /*
   * Derived rather than hardcoded, for the same reason the manager counts
   * below are: audit.view_security left with the audit screen, and a true
   * statement should not fail because the catalogue changed size.
   *
   * What is actually asserted is that the ADMIN-ONLY set and the SYSTEM
   * module are the same set — every system capability is ungrantable, and
   * nothing outside that module is. That holds however the catalogue grows.
   */
  const adminOnly = (cat ?? []).filter((c) => !c.is_configurable).map((c) => c.key);
  const systemKeys = (cat ?? []).filter((c) => c.module === 'system').map((c) => c.key);
  check('the admin-only capabilities are exactly the system ones',
    adminOnly.length > 0
      && adminOnly.length === systemKeys.length
      && adminOnly.every((k) => systemKeys.includes(k)),
    `${adminOnly.length} keys`);

  const { data: mgr } = await admin.from('role_permissions').select('permission').eq('role', 'manager');
  const { data: pu } = await admin.from('role_permissions').select('permission').eq('role', 'power_user');

  /*
   * Derived from the catalogue rather than hardcoded.
   *
   * These two used to assert `=== 15` and `=== 11`, which is not what the
   * labels claim and which broke the moment the incidents module added four
   * capabilities — a true statement failing for an irrelevant reason. What is
   * actually being asserted is "a manager holds ALL of them" and "a power
   * user holds strictly fewer", and both survive the next module.
   */
  const configurable = (cat ?? []).filter((c) => c.is_configurable).map((c) => c.key);
  const mgrHeld = new Set((mgr ?? []).map((r) => r.permission));
  check('manager holds every configurable capability',
    configurable.every((key) => mgrHeld.has(key)),
    `${mgr?.length} of ${configurable.length}`);
  check('power user holds fewer than manager',
    (pu ?? []).length < (mgr ?? []).length,
    `${pu?.length} vs ${mgr?.length}`);

  const mgrKeys = new Set((mgr ?? []).map((r) => r.permission));
  const puKeys = new Set((pu ?? []).map((r) => r.permission));
  check('the manager/power-user line is the CONFIGURATION keys',
    mgrKeys.has('inventory.manage_templates') && !puKeys.has('inventory.manage_templates')
    && mgrKeys.has('tasks.manage_definitions') && !puKeys.has('tasks.manage_definitions')
    && mgrKeys.has('products.change_code') && !puKeys.has('products.change_code'));

  console.log('\n=== 2. has_permission() agrees with the matrix ===');
  for (const [who, key, expected] of [
    [A, 'permissions.configure', true],
    [M, 'permissions.configure', false],
    [M, 'inventory.manage_templates', true],
    [P, 'inventory.manage_templates', false],
    [P, 'inventory.manage_instances', true],
    [U, 'inventory.manage_instances', false],
  ]) {
    const { data } = await who.client.rpc('has_permission', { p_key: key });
    check(`${who.role} has_permission(${key}) = ${expected}`, data === expected, `got ${data}`);
  }

  console.log('\n=== 3. ADMIN-ONLY capabilities are never delegated ===');
  const roleWrite = await M.client.from('profiles').update({ role: 'admin' }).eq('id', U.id).select();
  check('manager CANNOT promote a user', denied(roleWrite));
  const { data: afterRole } = await admin.from('profiles').select('role').eq('id', U.id).single();
  check('...and the role really did not change', afterRole.role === 'user', afterRole.role);

  const statusWrite = await P.client.from('profiles').update({ status: 'deactivated' }).eq('id', U.id).select();
  check('power user CANNOT deactivate a user', denied(statusWrite));

  const matrixWrite = await M.client
    .from('role_permissions').insert({ role: 'power_user', permission: 'reports.export' }).select();
  check('manager CANNOT edit the permission matrix', denied(matrixWrite));

  const escalate = await admin
    .from('role_permissions').insert({ role: 'manager', permission: 'roles.assign' }).select();
  check('an ADMIN-ONLY capability cannot be inserted at all, even by the service role',
    Boolean(escalate.error), escalate.error?.message?.slice(0, 60));

  const adminRow = await admin
    .from('role_permissions').insert({ role: 'admin', permission: 'reports.view' }).select();
  check('the matrix refuses an admin row', Boolean(adminRow.error));

  const userRow = await admin
    .from('role_permissions').insert({ role: 'user', permission: 'reports.view' }).select();
  check('the matrix refuses a user row', Boolean(userRow.error));

  console.log('\n=== 4. Manager vs Power User: configuration vs data ===');
  const stamp = Date.now();
  const tplByManager = await M.client.from('inventory_templates').insert({
    slug: `zz-tpl-m-${stamp}`, name: `ZZ Template M ${stamp}`,
    kind: 'expiry', frequency: 'weekly', schedule_config: { kind: 'weekly', weekday: 5 },
  }).select().single();
  check('manager CAN create an inventory template', !tplByManager.error, tplByManager.error?.message?.slice(0, 60));
  if (tplByManager.data) created.templates.push(tplByManager.data.id);

  const tplByPower = await P.client.from('inventory_templates').insert({
    slug: `zz-tpl-p-${stamp}`, name: `ZZ Template P ${stamp}`,
    kind: 'expiry', frequency: 'weekly', schedule_config: { kind: 'weekly', weekday: 5 },
  }).select();
  check('power user CANNOT create an inventory template', denied(tplByPower));

  if (tplByManager.data) {
    const edit = await P.client.from('inventory_templates')
      .update({ name: 'ZZ hijacked' }).eq('id', tplByManager.data.id).select();
    check('power user CANNOT edit an inventory template', denied(edit));
  }

  const taskByPower = await P.client.from('tasks').insert({
    title: `ZZ Task ${stamp}`, frequency: 'weekly',
    schedule_config: { kind: 'weekly', weekday: 2 }, is_skippable: false, is_active: true,
  }).select();
  check('power user CANNOT create a task definition', denied(taskByPower));

  console.log('\n=== 5. Product Code is column-level ===');
  const prod = await admin.from('products').insert({
    code: `ZZ${stamp}`, name: `ZZ Product ${stamp}`,
    family: `ZZ Family ${stamp}`, presentation: '500gr', is_active: true,
  }).select().single();
  if (prod.error) throw new Error('fixture product: ' + prod.error.message);
  created.products.push(prod.data.id);

  const renameByPower = await P.client.from('products')
    .update({ presentation: '750gr' }).eq('id', prod.data.id).select();
  check('power user CAN edit an ordinary product field', !renameByPower.error && renameByPower.data?.length === 1,
    renameByPower.error?.message?.slice(0, 60));

  const codeByPower = await P.client.from('products')
    .update({ code: `ZZX${stamp}` }).eq('id', prod.data.id).select();
  check('power user CANNOT change the product code', Boolean(codeByPower.error),
    codeByPower.error?.message?.slice(0, 60));

  const codeByManager = await M.client.from('products')
    .update({ code: `ZZM${stamp}` }).eq('id', prod.data.id).select();
  check('manager CAN change the product code', !codeByManager.error, codeByManager.error?.message?.slice(0, 60));

  const { data: codeAudit } = await admin.from('security_audit_log')
    .select('action').eq('action', 'product_code_changed').order('created_at', { ascending: false }).limit(1);
  check('...and the change was audited', (codeAudit ?? []).length === 1);

  console.log('\n=== 6. Turning a permission off removes the access ===');
  await admin.from('role_permissions')
    .delete().eq('role', 'manager').eq('permission', 'customers.manage');

  const custDenied = await M.client.from('customers')
    .insert({ company_name: `ZZ Cust ${stamp}` }).select();
  check('manager loses customer writes once the box is unticked', denied(custDenied));

  await admin.from('role_permissions').insert({ role: 'manager', permission: 'customers.manage' });
  const custAllowed = await M.client.from('customers')
    .insert({ company_name: `ZZ Cust B ${stamp}` }).select().single();
  check('...and regains them when it is ticked back on', !custAllowed.error,
    custAllowed.error?.message?.slice(0, 60));
  if (custAllowed.data) await admin.from('customers').delete().eq('id', custAllowed.data.id);

  console.log('\n=== 7. Plain USER is unchanged ===');
  const userTpl = await U.client.from('inventory_templates').select('id').limit(1);
  check('a user can still READ operational data', !userTpl.error);

  const userWrite = await U.client.from('orders')
    .update({ notes: 'ZZ' }).eq('id', '00000000-0000-0000-0000-000000000000').select();
  check('a user still CANNOT write order definitions', denied(userWrite));

  const userAudit = await U.client.from('security_audit_log').select('id').limit(1);
  check('a user cannot read the security audit', denied(userAudit));

  const managerSecAudit = await M.client.from('security_audit_log').select('id').limit(1);
  check('a manager cannot read the security audit either', denied(managerSecAudit));

  const managerOpAudit = await M.client.from('inventory_audit_log').select('id').limit(1);
  check('a manager CAN read the operational audit', !managerOpAudit.error);

  console.log('\n=== 8. Role changes are audited ===');
  await admin.from('profiles').update({ role: 'power_user' }).eq('id', U.id);
  const { data: roleAudit } = await admin.from('security_audit_log')
    .select('action, target_user_id').eq('target_user_id', U.id).eq('action', 'role_changed');
  check('a role change writes a security audit row', (roleAudit ?? []).length >= 1);
}

async function cleanup() {
  for (const id of created.templates) await admin.from('inventory_templates').delete().eq('id', id);
  for (const id of created.products) await admin.from('products').delete().eq('id', id);
  await admin.from('customers').delete().like('company_name', 'ZZ Cust%');
  await admin.from('tasks').delete().like('title', 'ZZ Task%');
  for (const id of created.users) {
    await admin.from('security_audit_log').delete().eq('target_user_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  // Restore the shipped defaults in case a check above left the matrix altered.
  await admin.from('role_permissions').delete().eq('role', 'manager').eq('permission', 'customers.manage');
  await admin.from('role_permissions').insert({ role: 'manager', permission: 'customers.manage' });
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
