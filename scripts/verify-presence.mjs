/**
 * End-to-end verification of "who is online".
 *
 *   node scripts/verify-presence.mjs
 *
 * Checks the half that lives in Postgres:
 *
 *   - an approved user's check-in records where they are
 *   - an admin and a manager can read presence — not a power user, not the user
 *   - nobody can write a presence row directly, only through touch_presence()
 *   - a pending account never shows up as using the app
 *   - a check-in after a gap starts a new stretch; a steady one does not
 *
 * Every check runs as a real signed-in user through the anon key. Throwaway
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
  const email = `zz-presence-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
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

const rowOf = async (id) =>
  (await admin.from('user_presence').select('*').eq('user_id', id).maybeSingle()).data;

async function main() {
  const A = await makeUser('admin');
  const M = await makeUser('manager');
  const P = await makeUser('power_user');
  const U = await makeUser('user');
  const Pending = await makeUser('user', 'pending');

  console.log('\n=== 1. A check-in records where somebody is ===');
  const touch = await U.client.rpc('touch_presence', { p_path: '/orders/abc' });
  check('an approved user can check in', !touch.error, touch.error?.message);
  const first = await rowOf(U.id);
  check('the row holds the screen', first?.path === '/orders/abc', first?.path);

  await U.client.rpc('touch_presence', { p_path: '/inventory' });
  const second = await rowOf(U.id);
  check('a later check-in moves them', second?.path === '/inventory', second?.path);
  check('a steady check-in keeps the stretch start', second?.started_at === first?.started_at);

  console.log('\n=== 2. Admin and Manager see it, nobody else ===');
  const asAdmin = await A.client.from('user_presence').select('user_id').eq('user_id', U.id);
  check('admin reads a presence row', (asAdmin.data ?? []).length === 1, asAdmin.error?.message);
  const asManager = await M.client.from('user_presence').select('user_id').eq('user_id', U.id);
  check('manager reads a presence row', (asManager.data ?? []).length === 1, asManager.error?.message);
  const asPower = await P.client.from('user_presence').select('user_id');
  check('power user reads nothing', !asPower.error && (asPower.data ?? []).length === 0);
  const asUser = await U.client.from('user_presence').select('user_id');
  check('a user cannot read even their own row', !asUser.error && (asUser.data ?? []).length === 0);

  console.log('\n=== 3. Nobody writes it directly ===');
  const ins = await P.client.from('user_presence').insert({ user_id: P.id, path: '/x' });
  check('direct insert is refused', Boolean(ins.error));
  await U.client.from('user_presence').update({ path: '/forged' }).eq('user_id', U.id);
  check('direct update changes nothing', (await rowOf(U.id))?.path === '/inventory');

  console.log('\n=== 4. A pending account never appears ===');
  const pendingTouch = await Pending.client.rpc('touch_presence', { p_path: '/dashboard' });
  check('pending check-in is accepted silently', !pendingTouch.error, pendingTouch.error?.message);
  check('and records nothing', (await rowOf(Pending.id)) === null);

  console.log('\n=== 5. A gap starts a new stretch ===');
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  await admin.from('user_presence').update({ last_seen_at: old, started_at: old }).eq('user_id', U.id);
  await U.client.rpc('touch_presence', { p_path: '/dashboard' });
  const back = await rowOf(U.id);
  check('started_at resets after a gap', Date.parse(back.started_at) > Date.parse(old) + 5 * 60_000, back.started_at);

  console.log('\n=== 6. Anonymous callers are refused ===');
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const anonTouch = await anon.rpc('touch_presence', { p_path: '/dashboard' });
  check('anon cannot check in', Boolean(anonTouch.error));
}

async function cleanup() {
  for (const id of created) {
    await admin.from('user_presence').delete().eq('user_id', id);
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
