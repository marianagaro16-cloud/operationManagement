/**
 * End-to-end verification of the push pipeline.
 *
 * Exercises the real parts: VAPID configuration, payload encryption, RLS on
 * push_subscriptions, and the dedupe constraint that stops an alert firing on
 * every scheduler tick. Cleans up everything it creates.
 *
 * It does NOT deliver to a real device — that needs a browser — but it does
 * verify that a correctly encrypted request is produced and that a revoked
 * endpoint is handled the way a real one would be.
 */
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { createECDH, randomBytes } from 'node:crypto';
import { config } from 'dotenv';

config({ path: '.env' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
};

const PW = 'Throwaway-Test-Pw-9137';
const created = { users: [], orders: [], customers: [], products: [] };

async function makeUser(role) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-push-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({ email, password: PW, options: { data: { name: `Push ${role}` } } });
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
  console.log('\n=== 1. VAPID configuration ===');
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  check('public key present and correctly sized', !!pub && pub.length === 87, `len=${pub?.length}`);
  check('private key present and correctly sized', !!priv && priv.length === 43, `len=${priv?.length}`);
  let vapidOk = true;
  try { webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:a@b.c', pub, priv); }
  catch (e) { vapidOk = false; console.log('    ' + e.message); }
  check('web-push accepts the keypair', vapidOk);

  console.log('\n=== 2. Payload encryption ===');
  // A REAL P-256 keypair, generated here. A hand-written example key is not a
  // valid curve point and would fail encryption for reasons that have nothing
  // to do with this application.
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const p256dh = ecdh.getPublicKey().toString('base64url');
  const auth = randomBytes(16).toString('base64url');

  // Encryption is pure crypto — no network — so it is asserted on its own.
  let cipherBytes = 0;
  try {
    cipherBytes = webpush.encrypt(
      p256dh, auth, JSON.stringify({ title: 'Pedido atrasado', body: 'x' }), 'aes128gcm',
    ).cipherText.length;
  } catch (e) {
    console.log('    ' + e.message);
  }
  check('payload encrypts for a real subscriber key', cipherBytes > 0, `${cipherBytes} bytes`);

  // Then the network leg: a well-formed but dead endpoint must come back
  // 404/410, which is exactly how a browser-revoked subscription behaves and
  // is what the sender prunes on.
  let statusCode = null;
  try {
    await webpush.sendNotification(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/zz-not-a-real-endpoint', keys: { p256dh, auth } },
      JSON.stringify({ title: 'x', body: 'y' }),
    );
  } catch (e) {
    statusCode = e.statusCode ?? null;
  }
  check('revoked endpoint reports gone (404/410)', statusCode === 404 || statusCode === 410, `status=${statusCode}`);

  console.log('\n=== 3. Subscription RLS ===');
  const A = await makeUser('user');
  const B = await makeUser('user');
  const ADM = await makeUser('admin');
  created.users.push(A.id, B.id, ADM.id);

  const endpointA = `https://example.com/push/zz-${Date.now()}-A`;
  const { error: insErr } = await A.client.from('push_subscriptions').insert({
    user_id: A.id, endpoint: endpointA, p256dh: 'k', auth: 'a', user_agent: 'test',
  });
  check('user can register their own device', !insErr, insErr?.message);

  const { error: forgeErr } = await B.client.from('push_subscriptions').insert({
    user_id: A.id, endpoint: `${endpointA}-forged`, p256dh: 'k', auth: 'a',
  });
  check('user cannot register a device for someone else', !!forgeErr, forgeErr?.code);

  const { data: bSees } = await B.client.from('push_subscriptions').select('id').eq('endpoint', endpointA);
  check("another user cannot read someone's endpoint", (bSees?.length ?? 0) === 0);

  const { data: admSees } = await ADM.client.from('push_subscriptions').select('id').eq('endpoint', endpointA);
  check('even an admin cannot read it (capability URL, not team data)', (admSees?.length ?? 0) === 0);

  const { data: ownSees } = await A.client.from('push_subscriptions').select('id').eq('endpoint', endpointA);
  check('the owner can read their own', (ownSees?.length ?? 0) === 1);

  await B.client.from('push_subscriptions').delete().eq('endpoint', endpointA);
  const { count: stillThere } = await admin
    .from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('endpoint', endpointA);
  check('another user cannot delete it', stillThere === 1);

  // Re-subscribing the same browser must update, not duplicate.
  const { error: dupErr } = await A.client.from('push_subscriptions').insert({
    user_id: A.id, endpoint: endpointA, p256dh: 'k2', auth: 'a2',
  });
  check('duplicate endpoint is rejected (upsert territory)', !!dupErr, dupErr?.code);

  console.log('\n=== 4. Notification dedupe ===');
  const { data: cust } = await admin.from('customers').insert({ name: `ZZ Push Customer ${Date.now()}` }).select().single();
  created.customers.push(cust.id);
  const stamp = Date.now();
  const { data: prod } = await admin.from('products')
    .insert({ code: `ZP${stamp}`, family: `ZZ Push ${stamp}`, presentation: '1kg', is_active: true })
    .select().single();
  created.products.push(prod.id);
  const { data: ord } = await admin.from('orders').insert({
    customer_id: cust.id, delivery_date: '2026-09-10', delivery_time: '14:00',
    preparation_date: '2026-09-10', status: 'confirmed', order_type: 'sale',
  }).select().single();
  created.orders.push(ord.id);
  await admin.from('order_lines').insert({ order_id: ord.id, product_id: prod.id, ordered_quantity: 10, position: 0 });

  const { error: n1 } = await admin.from('order_notifications').insert({ order_id: ord.id, level: 'warning' });
  check('first notification for a level is recorded', !n1, n1?.message);
  const { error: n2 } = await admin.from('order_notifications').insert({ order_id: ord.id, level: 'warning' });
  check('the SAME level cannot be recorded twice', !!n2, n2?.code);
  const { error: n3 } = await admin.from('order_notifications').insert({ order_id: ord.id, level: 'critical' });
  check('an escalation to a new level IS allowed', !n3, n3?.message);
  const { error: badLevel } = await admin.from('order_notifications').insert({ order_id: ord.id, level: 'soon' });
  check('a non-notifiable level is rejected', !!badLevel, badLevel?.code);

  const { data: userLog } = await A.client.from('order_notifications').select('id').eq('order_id', ord.id);
  check('a user cannot read the notification log', (userLog?.length ?? 0) === 0);
  const { data: admLog } = await ADM.client.from('order_notifications').select('id').eq('order_id', ord.id);
  check('an admin can read the notification log', (admLog?.length ?? 0) === 2);

  console.log('\n=== 5. Cascade cleanup ===');
  await admin.from('orders').delete().eq('id', ord.id);
  created.orders = created.orders.filter((x) => x !== ord.id);
  const { count: logsLeft } = await admin
    .from('order_notifications').select('id', { count: 'exact', head: true }).eq('order_id', ord.id);
  check('deleting an order clears its notification log', logsLeft === 0);
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
