/**
 * End-to-end verification of moving a blocked activity to another day.
 *
 *   node scripts/verify-reschedule.mjs
 *
 * Every assertion runs as a REAL signed-in user through the anon key, the
 * path a browser takes.
 *
 *   - only whoever plans the calendar may move a blocked day; the person
 *     whose work it is may not, nor a production manager outside their areas
 *   - not into the past, not onto the day it is already on, and not onto a
 *     day where that person already has the activity
 *   - moved, it is pending on the new day and keeps the day it came from and
 *     what was blocking it
 *   - only a blocked day moves; a planner can also free it where it is
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

const errorOf = (res) => res.error?.message ?? '';

async function makeUser(label, role, team) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-resched-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
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

const created = { users: [], tasks: [] };

/** The business day, as the database reads it. */
const zurich = (offset = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date(Date.now() + offset * 86_400_000));

const move = (who, id, date) =>
  who.client.rpc('reschedule_blocked_occurrence', { p_occurrence_id: id, p_date: date, p_period_key: date });

async function main() {
  const MGR = await makeUser('mgr', 'manager', 'operations');
  const WORKER = await makeUser('worker', 'user', 'operations');
  const PM = await makeUser('pm', 'production_manager', 'production');
  created.users.push(MGR.id, WORKER.id, PM.id);

  const today = zurich(0), tomorrow = zurich(1), yesterday = zurich(-1);

  const { data: task, error: taskError } = await admin.from('tasks')
    .insert({ title: 'ZZ reschedule check', frequency: 'one_off', schedule_config: null, is_active: true, team: 'operations', starts_on: today })
    .select('id').single();
  if (taskError) throw new Error('task: ' + taskError.message);
  created.tasks.push(task.id);

  const day = async (date) => {
    const { data, error } = await admin.from('task_occurrences')
      .insert({ task_id: task.id, period_key: date, due_date: date, source: 'manual', assignee_id: WORKER.id })
      .select('id').single();
    if (error) throw new Error('occurrence: ' + error.message);
    return data.id;
  };
  const read = async (id) => (await admin.from('task_occurrences').select('*').eq('id', id).single()).data;

  console.log('\n=== 1. Who may move a blocked day ===');
  const first = await day(today);
  const pendingMove = await move(MGR, first, tomorrow);
  check('a day that is not blocked does not move', errorOf(pendingMove).includes('not_blocked'), errorOf(pendingMove));

  const block = await WORKER.client.rpc('block_occurrence', { p_occurrence_id: first, p_reason: 'falta de tiempo' });
  check('the person blocks their own activity', !block.error, errorOf(block));

  const own = await move(WORKER, first, tomorrow);
  check('the person whose work it is cannot move it', errorOf(own).includes('not_authorized'), errorOf(own));
  const outsider = await move(PM, first, tomorrow);
  check('a production manager cannot move another area\'s', errorOf(outsider).includes('not_authorized'), errorOf(outsider));

  console.log('\n=== 2. Where it may go ===');
  const past = await move(MGR, first, yesterday);
  check('not into the past', errorOf(past).includes('date_in_past'), errorOf(past));
  const same = await move(MGR, first, today);
  check('not onto the day it is already on', errorOf(same).includes('same_day'), errorOf(same));

  console.log('\n=== 3. Moved ===');
  const moved = await move(MGR, first, tomorrow);
  check('the planner moves it', !moved.error, errorOf(moved));
  const after = await read(first);
  check('it is on the new day', after.due_date === tomorrow && after.effective_due_date === tomorrow, after.effective_due_date);
  check('pending again, the block cleared', after.status === 'pending' && after.blocked_reason === null && after.blocked_by === null);
  check('it keeps the day it came from', after.rescheduled_from === today, after.rescheduled_from);
  check('...and what was blocking it', after.rescheduled_reason === 'falta de tiempo', after.rescheduled_reason);
  check('...and who moved it', after.rescheduled_by === MGR.id && after.rescheduled_at !== null);

  console.log('\n=== 4. One copy per person and day ===');
  const second = await day(today);
  await WORKER.client.rpc('block_occurrence', { p_occurrence_id: second, p_reason: 'sin material' });
  const clash = await move(MGR, second, tomorrow);
  check('not onto a day where the person already has it', errorOf(clash).includes('already_planned'), errorOf(clash));
  check('...and it stays blocked where it was', (await read(second)).status === 'blocked');

  console.log('\n=== 5. Freed on its day ===');
  const freed = await MGR.client.rpc('reopen_occurrence', { p_occurrence_id: second });
  check('the planner unblocks someone else\'s block', !freed.error, errorOf(freed));
  const open = await read(second);
  check('pending on the same day, with no trace of a move', open.status === 'pending' && open.due_date === today && open.rescheduled_from === null);
}

async function cleanup() {
  if (created.tasks.length) {
    await admin.from('task_occurrences').delete().in('task_id', created.tasks);
    await admin.from('tasks').delete().in('id', created.tasks);
  }
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
