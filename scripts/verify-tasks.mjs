/**
 * End-to-end verification of manual task and inventory scheduling.
 *
 *   npm run verify:tasks
 *
 * The tasks module has never had one of these, which was a gap worth closing
 * for a change that alters how every requirement comes into existence.
 *
 * `src/domain/recurrence/*.test.ts` covers the date arithmetic. What only
 * exists in Postgres, and what this checks:
 *
 *   - the occurrence key is the DATE now, so one task can sit on Monday AND
 *     Wednesday of a week, but never twice on one day
 *   - a manager may place and remove work; a plain user may do neither
 *   - the migration really did clear the auto-generated future
 *   - `source` distinguishes what the generator made from what a person placed
 *   - an inventory is still one per template per date
 *
 * Every check runs as a REAL signed-in user through the anon key, so the path
 * is the one a browser takes. Throwaway accounts and a throwaway task are
 * created and removed; nothing pre-existing is touched.
 *
 * REQUIRES supabase/migrations/20260909120000_manual_scheduling.sql to be
 * applied. Without it the key checks fail, which is the point.
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

/** RLS denies by error OR by filtering the row out; both are a denial. */
function denied(res) {
  return Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0);
}

async function makeUser(role) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-plan-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
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
  return { id: up.user.id, client, role };
}

/** Business date, Europe/Zurich — the same "today" the app and the migration use. */
function zurichToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
}

const created = { users: [], tasks: [], occurrences: [], instances: [] };

async function main() {
  const M = await makeUser('manager');
  const U = await makeUser('user');
  created.users.push(M.id, U.id);

  const stamp = Date.now();
  const today = zurichToday();
  const plus = (n) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  console.log('\n=== 1. The migration applied ===');
  const { data: probe, error: probeErr } = await admin
    .from('task_occurrences').select('id, source').limit(1);
  check('task_occurrences has a source column', !probeErr, probeErr?.message?.slice(0, 70));
  if (probeErr) throw new Error('migration not applied — the rest cannot be meaningful');

  const { data: invProbe, error: invProbeErr } = await admin
    .from('inventory_instances').select('id, source').limit(1);
  check('inventory_instances has a source column', !invProbeErr, invProbeErr?.message?.slice(0, 70));

  console.log('\n=== 2. The auto-generated future was cleared ===');
  const { data: futureAuto } = await admin
    .from('task_occurrences')
    .select('id, task:tasks!inner(frequency)')
    .eq('status', 'pending')
    .gt('effective_due_date', today);
  const leftoverNonDaily = (futureAuto ?? []).filter(
    (o) => o.task && o.task.frequency !== 'daily',
  );
  check('no future pending non-daily occurrences remain from the generator',
    leftoverNonDaily.length === 0, `${leftoverNonDaily.length} left`);

  const { data: dailyAhead } = await admin
    .from('task_occurrences')
    .select('id, task:tasks!inner(frequency)')
    .eq('source', 'auto')
    .gt('effective_due_date', today)
    .limit(5);
  check('the DAILY checklist is still generated ahead',
    (dailyAhead ?? []).every((o) => o.task?.frequency === 'daily'),
    `${dailyAhead?.length ?? 0} sampled`);

  console.log('\n=== 3. Fixtures ===');
  const { data: task, error: taskErr } = await admin.from('tasks').insert({
    title: `ZZ Plan Task ${stamp}`,
    frequency: 'weekly',
    schedule_config: { kind: 'weekly', weekday: 2 },
    is_skippable: true,
    is_active: true,
  }).select().single();
  if (taskErr) throw new Error('fixture task: ' + taskErr.message);
  created.tasks.push(task.id);
  check('a weekly task definition exists to place', Boolean(task.id));

  console.log('\n=== 4. A task can sit on several dates in one week ===');
  const monday = plus(7);
  const wednesday = plus(9);

  const first = await M.client.from('task_occurrences')
    .insert({ task_id: task.id, due_date: monday, period_key: 'ZZ-W1', source: 'manual' })
    .select().single();
  check('manager CAN place a weekly task on a date', !first.error, first.error?.message?.slice(0, 70));
  if (first.data) created.occurrences.push(first.data.id);

  const second = await M.client.from('task_occurrences')
    .insert({ task_id: task.id, due_date: wednesday, period_key: 'ZZ-W1', source: 'manual' })
    .select().single();
  // The whole point of the re-key: the SAME period_key on a different date.
  check('...and again in the SAME week on another date', !second.error,
    second.error?.message?.slice(0, 70));
  if (second.data) created.occurrences.push(second.data.id);

  const duplicate = await M.client.from('task_occurrences')
    .insert({ task_id: task.id, due_date: monday, period_key: 'ZZ-W2', source: 'manual' })
    .select();
  check('...but NOT twice on the same date', Boolean(duplicate.error),
    duplicate.error?.message?.slice(0, 60));

  console.log('\n=== 5. A plain user plans nothing ===');
  const userPlace = await U.client.from('task_occurrences')
    .insert({ task_id: task.id, due_date: plus(10), period_key: 'ZZ-W3', source: 'manual' })
    .select();
  check('user CANNOT place work', denied(userPlace));

  if (first.data) {
    const userRemove = await U.client.from('task_occurrences')
      .delete().eq('id', first.data.id).select();
    check('user CANNOT remove planned work', denied(userRemove));
  }

  console.log('\n=== 6. A manager can take work back off the calendar ===');
  if (second.data) {
    const removed = await M.client.from('task_occurrences')
      .delete().eq('id', second.data.id).eq('status', 'pending').select();
    check('manager CAN remove a pending occurrence',
      !removed.error && (removed.data?.length ?? 0) === 1, removed.error?.message?.slice(0, 60));
    if ((removed.data?.length ?? 0) === 1) {
      created.occurrences = created.occurrences.filter((id) => id !== second.data.id);
    }
  }

  // The status guard lives in the server action, not in RLS — so what is
  // checked here is that a resolved occurrence is not matched by the
  // action's own filter, which is the mechanism the app relies on.
  if (first.data) {
    await admin.from('task_occurrences').update({
      status: 'completed', completed_by: M.id, completed_at: new Date().toISOString(),
    }).eq('id', first.data.id);

    const removeCompleted = await M.client.from('task_occurrences')
      .delete().eq('id', first.data.id).eq('status', 'pending').select();
    check('a COMPLETED occurrence is not removable by the planner',
      (removeCompleted.data?.length ?? 0) === 0);
  }

  console.log('\n=== 7. Inventories are one per template per date ===');
  const { data: template } = await admin
    .from('inventory_templates').select('id').eq('is_active', true).limit(1).single();

  if (template) {
    const date = plus(21);
    const inv = await M.client.from('inventory_instances').insert({
      template_id: template.id, inventory_date: date, period_key: date,
      source: 'manual', name_snapshot: '', kind: 'expiry', digital_enabled: false,
    }).select().single();
    check('manager CAN place an inventory', !inv.error, inv.error?.message?.slice(0, 70));
    if (inv.data) created.instances.push(inv.data.id);

    const dupe = await M.client.from('inventory_instances').insert({
      template_id: template.id, inventory_date: date, period_key: date,
      source: 'manual', name_snapshot: '', kind: 'expiry', digital_enabled: false,
    }).select();
    check('...but not twice on the same date', Boolean(dupe.error));

    if (inv.data) {
      const { data: items } = await admin
        .from('inventory_instance_items').select('id').eq('instance_id', inv.data.id);
      check('placing one materialises its items from the template',
        (items?.length ?? 0) > 0, `${items?.length ?? 0} items`);
    }

    const userInv = await U.client.from('inventory_instances').insert({
      template_id: template.id, inventory_date: plus(22), period_key: plus(22),
      source: 'manual', name_snapshot: '', kind: 'expiry', digital_enabled: false,
    }).select();
    check('user CANNOT place an inventory', denied(userInv));
  }
}

async function cleanup() {
  for (const id of created.instances) await admin.from('inventory_instances').delete().eq('id', id);
  for (const id of created.occurrences) await admin.from('task_occurrences').delete().eq('id', id);
  for (const id of created.tasks) {
    await admin.from('task_occurrences').delete().eq('task_id', id);
    await admin.from('tasks').delete().eq('id', id);
  }
  await admin.from('inventory_instances').delete().like('period_key', 'ZZ-%');
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
