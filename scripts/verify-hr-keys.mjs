/**
 * End-to-end verification of the key register against the real database.
 *
 *   node scripts/verify-hr-keys.mjs
 *
 * Checks what exists only in Postgres — who may read and write a key, that a
 * holder is a worker or a name and never both, and that only an Admin removes
 * a row — as REAL signed-in users through the anon key.
 *
 * Three throwaway accounts and one throwaway worker file are created and
 * removed; the keys recorded here go with them.
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
const created = { users: [], worker: null, keys: [] };
let pass = 0, fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}

const why = (res) => res.error?.message ?? JSON.stringify(res.data);

async function makeUser(role, label) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-hrk-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({ email, password: PW, options: { data: { name: `ZZ ${label}` } } });
  if (error) throw new Error('signUp: ' + error.message);
  created.users.push(up.user.id);
  await admin.from('profiles').update({ status: 'approved', role, team: 'operations' }).eq('id', up.user.id);
  const { data: si, error: siError } = await anon.auth.signInWithPassword({ email, password: PW });
  if (siError) throw new Error('signIn: ' + siError.message);
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
  return { id: up.user.id, client };
}

const day = (offset) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

async function main() {
  const manager = await makeUser('manager', 'manager');
  const boss = await makeUser('admin', 'admin');
  const plain = await makeUser('user', 'plain');

  const { data: worker, error: workerError } = await admin
    .from('hr_workers')
    .insert({ name: 'ZZ Key worker', team: 'operations', profile_id: plain.id })
    .select('id')
    .single();
  if (workerError) throw new Error('worker: ' + workerError.message);
  created.worker = worker.id;

  const row = (over = {}) => ({ key_number: 'ZZ-14', worker_id: worker.id, holder_name: null, handed_on: day(-10), ...over });

  let res = await manager.client.from('hr_keys').insert(row()).select('id').single();
  check('someone with access to files records a worker\'s key', !res.error, why(res));
  const workerKey = res.data?.id;
  res = await manager.client.from('hr_keys').insert(row({ key_number: 'ZZ-22', worker_id: null, holder_name: 'ZZ Limpieza externa', holder_detail: 'Empresa' })).select('id').single();
  check('…and the key of an external person, by name', !res.error, why(res));
  const externalKey = res.data?.id;
  if (externalKey) created.keys.push(externalKey);

  res = await manager.client.from('hr_keys').insert(row({ holder_name: 'Both' }));
  check('a holder is a worker or a name, not both', Boolean(res.error), why(res));
  res = await manager.client.from('hr_keys').insert(row({ worker_id: null }));
  check('…and not nobody', Boolean(res.error), why(res));
  res = await manager.client.from('hr_keys').insert(row({ returned_on: day(-20) }));
  check('a key cannot come back before it was handed over', Boolean(res.error), why(res));

  res = await plain.client.from('hr_keys').select('id').in('id', [workerKey, externalKey]);
  check('someone without access to files reads no keys — not even their own', (res.data ?? []).length === 0, why(res));
  res = await plain.client.from('hr_keys').insert(row({ key_number: 'ZZ-99', worker_id: null, holder_name: 'x' }));
  check('…and records none', Boolean(res.error), why(res));

  res = await manager.client.from('hr_keys').update({ returned_on: day(0) }).eq('id', workerKey).select('returned_on');
  check('the key is marked as returned', res.data?.[0]?.returned_on === day(0), why(res));
  res = await manager.client.from('hr_keys').delete().eq('id', workerKey).select('id');
  check('a Manager cannot remove a row', (res.data ?? []).length === 0, why(res));
  res = await boss.client.from('hr_keys').delete().eq('id', workerKey).select('id');
  check('an Admin can', (res.data ?? []).length === 1, why(res));
}

async function cleanup() {
  for (const id of created.keys) await admin.from('hr_keys').delete().eq('id', id);
  if (created.worker) await admin.from('hr_workers').delete().eq('id', created.worker);
  for (const id of created.users) {
    await admin.from('security_audit_log').delete().eq('target_user_id', id);
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
