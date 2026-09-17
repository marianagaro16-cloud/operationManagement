/**
 * End-to-end verification of the notification inbox.
 *
 *   node scripts/verify-inbox.mjs
 *
 * Checks the half that lives in Postgres:
 *
 *   - a sent notification is filed for each approved recipient, and only them
 *   - a person reads their own inbox and nobody else's, admins included
 *   - only the server (service role) can file a notification
 *   - every notification is kept, even one sharing a tag with an earlier one;
 *     an exact repeat changes nothing, so a scheduler retry never duplicates
 *     or re-marks an entry unread
 *   - marking read only ever touches the caller's own entries
 *
 * Every read runs as a real signed-in user through the anon key. Throwaway
 * accounts are created and removed; nothing pre-existing is touched.
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

const created = [];

async function makeUser(role, status = 'approved') {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-inbox-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({
    email, password: PW, options: { data: { name: `ZZ ${role}` } },
  });
  if (error) throw new Error('signUp: ' + error.message);
  created.push(up.user.id);
  await admin.from('profiles').update({ status, role }).eq('id', up.user.id);
  const { data: si } = await anon.auth.signInWithPassword({ email, password: PW });
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
  return { id: up.user.id, client };
}

const entriesOf = async (id) =>
  (await admin.from('notification_inbox').select('*').eq('user_id', id).order('created_at')).data ?? [];

const file = (ids, tag, title, body, extra = {}) =>
  admin.rpc('record_inbox_notification', {
    p_user_ids: ids,
    p_tag: tag,
    p_title: title,
    p_body: body,
    p_url: extra.url ?? null,
    p_level: extra.level ?? null,
  });

async function main() {
  const A = await makeUser('admin');
  const U = await makeUser('user');
  const V = await makeUser('user');
  const Pending = await makeUser('user', 'pending');
  const tag = `zz-order-${Date.now()}`;

  console.log('\n=== 1. Filing a notification ===');
  const rec = await file([U.id, V.id, Pending.id], tag, 'Order 12', 'Due in 2 hours', { url: '/orders', level: 'warning' });
  check('the service role can file one', !rec.error, rec.error?.message);
  check('each approved recipient gets it', (await entriesOf(U.id)).length === 1 && (await entriesOf(V.id)).length === 1);
  check('a pending account gets nothing', (await entriesOf(Pending.id)).length === 0);

  console.log('\n=== 2. Your own inbox only ===');
  const mine = await U.client.from('notification_inbox').select('id, user_id');
  check('a user reads their own entry', (mine.data ?? []).length === 1 && mine.data[0].user_id === U.id, mine.error?.message);
  const asAdmin = await A.client.from('notification_inbox').select('id').in('user_id', [U.id, V.id]);
  check("an admin cannot read anybody else's", !asAdmin.error && (asAdmin.data ?? []).length === 0);

  console.log('\n=== 3. Only the server files ===');
  const forged = await U.client.rpc('record_inbox_notification', {
    p_user_ids: [V.id], p_tag: 'zz-forged', p_title: 'Forged', p_body: '', p_url: null, p_level: null,
  });
  check('a signed-in user cannot call it', Boolean(forged.error));
  const ins = await U.client.from('notification_inbox').insert({ user_id: V.id, tag: 'zz-x', title: 'x' });
  check('nor insert directly', Boolean(ins.error));
  check('so nothing was added', (await entriesOf(V.id)).length === 1);

  console.log('\n=== 4. Nothing disappears; an exact repeat is not duplicated ===');
  const [before] = await entriesOf(U.id);
  await U.client.rpc('mark_inbox_read', { p_ids: [before.id] });
  check('a read entry is still there', (await entriesOf(U.id)).length === 1);
  await file([U.id], tag, 'Order 12', 'Due in 2 hours');
  const again = await entriesOf(U.id);
  check('a retry with the same text keeps it read', again[0].read_at !== null);
  check('and does not duplicate it', again.length === 1);

  await file([U.id], tag, 'Order 12', 'Overdue', { level: 'overdue' });
  const after = await entriesOf(U.id);
  check('an escalation is a new entry', after.length === 2 && after.some((e) => e.body === 'Overdue' && e.read_at === null));
  check('and the earlier one is kept, still read', after.some((e) => e.body === 'Due in 2 hours' && e.read_at !== null));

  await file([U.id], `${tag}-other`, 'Message', 'Come to the cold store');
  check('a different tag is its own entry', (await entriesOf(U.id)).length === 3);

  console.log('\n=== 5. Marking read ===');
  const vEntry = (await entriesOf(V.id))[0];
  await U.client.rpc('mark_inbox_read', { p_ids: [vEntry.id] });
  check("marking somebody else's id changes nothing", (await entriesOf(V.id))[0].read_at === null);
  await U.client.rpc('mark_inbox_read', {});
  check('mark all reads every own entry', (await entriesOf(U.id)).every((e) => e.read_at !== null));
  check("and nobody else's", (await entriesOf(V.id))[0].read_at === null);
}

async function cleanup() {
  for (const id of created) {
    await admin.from('notification_inbox').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

let aborted = null;

main()
  .catch((e) => { aborted = e.message; fail++; console.error('\nFATAL:', e.message); })
  .finally(async () => {
    await cleanup();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (aborted) console.log(`  ABORTED after ${pass} checks — the rest never ran: ${aborted}`);
    process.exit(fail === 0 ? 0 : 1);
  });
