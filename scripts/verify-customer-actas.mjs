/**
 * End-to-end verification of the Actas of meetings with customers, against
 * the real database.
 *
 *   node scripts/verify-customer-actas.mjs
 *
 * src/domain/sales/acta.test.ts covers what the form asks for; this checks
 * the half that exists only in Postgres — which activities owe an Acta, who
 * may write one, what it needs to be registered, that it is permanent
 * afterwards, who reads it, and that a won prospect's Actas move to the
 * customer — as REAL signed-in users, with the same reads the app makes.
 *
 * Four throwaway accounts, one customer, one prospect and a few activities
 * are created and removed. No real customer or activity is touched, and no
 * notification is sent.
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
const created = { users: [], customers: [], prospects: [], activities: [] };
let pass = 0, fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}

const errorIs = (res, code) => Boolean(res.error?.message?.includes(code));
const why = (res) => res.error?.message ?? JSON.stringify(res.data);

async function makeUser(role, label, team) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-acta-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({ email, password: PW, options: { data: { name: `ZZ ${label}` } } });
  if (error) throw new Error('signUp: ' + error.message);
  created.users.push(up.user.id);
  await admin.from('profiles').update({ status: 'approved', role, team }).eq('id', up.user.id);
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
  const seller = await makeUser('user', 'seller', 'sales');
  const other = await makeUser('user', 'other', 'sales');
  const boss = await makeUser('admin', 'admin', 'operations');
  const plain = await makeUser('user', 'plain', 'production');

  const { data: kinds } = await admin.from('sales_activity_kinds').select('id, slug').in('slug', ['visit', 'appointment', 'call']);
  const kind = Object.fromEntries(kinds.map((k) => [k.slug, k.id]));
  const { data: topics } = await admin.from('sales_acta_topics').select('id, slug');
  const topic = Object.fromEntries(topics.map((t) => [t.slug, t.id]));

  const { data: customer, error: customerError } = await admin.from('customers').insert({ company_name: 'ZZ Acta Cliente' }).select('id').single();
  if (customerError) throw new Error('customer: ' + customerError.message);
  created.customers.push(customer.id);
  const { data: prospect, error: prospectError } = await admin
    .from('prospects')
    .insert({ company_name: 'ZZ Acta Prospecto', contact_name: 'ZZ Contacto', owner_id: seller.id, created_by: seller.id })
    .select('id')
    .single();
  if (prospectError) throw new Error('prospect: ' + prospectError.message);
  created.prospects.push(prospect.id);

  async function plan(who, kindId, target, date = day(-3)) {
    const res = await who.client
      .from('sales_activities')
      .insert({ salesperson_id: who.id, created_by: who.id, kind_id: kindId, activity_date: date, title: target.title ?? null, customer_id: target.customer ?? null, prospect_id: target.prospect ?? null })
      .select('id')
      .single();
    if (res.error) throw new Error('activity: ' + res.error.message);
    created.activities.push(res.data.id);
    return res.data.id;
  }
  const done = (who, id) => who.client.from('sales_activities').update({ status: 'done', done_at: new Date().toISOString() }).eq('id', id).select('acta_required');
  const save = (who, id, content, register) => who.client.rpc('sales_acta_save', { p_activity_id: id, p_content: content, p_register: register });
  const content = (over = {}) => ({
    attendees: [
      { side: 'ours', profile_id: seller.id, name: '', role: '' },
      { side: 'theirs', profile_id: null, name: 'Ana Meier', role: 'Dueña' },
    ],
    points: [{ topic_id: topic.prices, title: 'Lista 2027', discussed: 'Aceptan la subida desde enero.', agreements: [{ body: 'Enviar la lista nueva', responsible_id: seller.id, due_on: day(5) }] }],
    follow_up_on: day(7),
    ...over,
  });

  console.log('\nWhich activities owe an Acta');
  const visit = await plan(seller, kind.visit, { customer: customer.id });
  let res = await save(seller, visit, content(), false);
  check('a visit still planned has no Acta', errorIs(res, 'acta_not_for_this'), why(res));
  res = await done(seller, visit);
  check('a visit with a customer, done, owes its Acta', res.data?.[0]?.acta_required === true, why(res));
  const call = await plan(seller, kind.call, { customer: customer.id });
  res = await done(seller, call);
  check('a call does not', res.data?.[0]?.acta_required === false, why(res));
  res = await save(seller, call, content(), false);
  check('and cannot have one', errorIs(res, 'acta_not_for_this'), why(res));
  const free = await plan(seller, kind.appointment, { title: 'ZZ preparar feria' });
  res = await done(seller, free);
  check('an appointment about nobody does not either', res.data?.[0]?.acta_required === false, why(res));

  console.log('\nThe reads the app makes');
  res = await seller.client
    .from('sales_activities')
    .select('id, acta_required, written:sales_actas ( registered_at )')
    .eq('id', visit)
    .single();
  check('an activity reads with its Acta: none yet', !res.error && res.data.acta_required && (res.data.written === null || res.data.written?.length === 0), why(res));
  const owed = () => seller.client
    .from('sales_activities')
    .select('id, acta:sales_actas ( activity_id )')
    .eq('salesperson_id', seller.id)
    .eq('acta_required', true)
    .eq('status', 'done')
    .is('acta', null);
  res = await owed();
  check('the visit is listed as owed', !res.error && res.data.map((a) => a.id).includes(visit), why(res));

  console.log('\nWriting the draft');
  res = await save(seller, visit, { attendees: [], points: [{ topic_id: null, title: '', discussed: '', agreements: [] }], follow_up_on: null }, false);
  check('an incomplete draft is saved', !res.error, why(res));
  res = await owed();
  check('once begun it is no longer "not begun"', !res.error && !res.data.map((a) => a.id).includes(visit), why(res));
  res = await seller.client
    .from('sales_actas')
    .select('activity_id, meeting_date, activity:sales_activities!inner ( acta_required )')
    .eq('salesperson_id', seller.id)
    .is('registered_at', null)
    .eq('activity.acta_required', true);
  check('but is listed as a draft still to register', !res.error && res.data.map((a) => a.activity_id).includes(visit), why(res));
  res = await save(other, visit, content(), false);
  check('another salesperson cannot write it', errorIs(res, 'not_authorized'), why(res));
  res = await save(plain, visit, content(), false);
  check('nor someone outside sales', errorIs(res, 'not_authorized'), why(res));
  res = await seller.client.from('sales_actas').update({ follow_up_on: day(1) }).eq('activity_id', visit).select('activity_id');
  check('nothing is written around the function', !res.data?.length, why(res));

  console.log('\nWhat it needs to be registered');
  res = await save(seller, visit, content({ attendees: [{ side: 'ours', profile_id: seller.id, name: '', role: '' }] }), true);
  check('someone from the customer', errorIs(res, 'attendee_required'), why(res));
  res = await save(seller, visit, content({ attendees: [{ side: 'theirs', profile_id: null, name: 'Ana', role: '' }] }), true);
  check('someone of ours', errorIs(res, 'attendee_required'), why(res));
  res = await save(seller, visit, content({ points: [] }), true);
  check('at least one point', errorIs(res, 'point_incomplete'), why(res));
  res = await save(seller, visit, content({ points: [{ topic_id: null, title: 'x', discussed: 'y', agreements: [] }] }), true);
  check('a topic per point', errorIs(res, 'topic_required'), why(res));
  res = await save(seller, visit, content({ points: [{ topic_id: topic.prices, title: '', discussed: ' ', agreements: [] }] }), true);
  check('what was said per point', errorIs(res, 'point_incomplete'), why(res));
  res = await save(seller, visit, content({ points: [{ topic_id: topic.prices, title: '', discussed: 'y', agreements: [{ body: 'x', responsible_id: plain.id, due_on: day(5) }] }] }), true);
  check('a responsible who is in sales', errorIs(res, 'responsible_not_sales'), why(res));
  res = await save(seller, visit, content({ points: [{ topic_id: topic.prices, title: '', discussed: 'y', agreements: [{ body: 'x', responsible_id: seller.id, due_on: day(-30) }] }] }), true);
  check('an agreement date not before the meeting', errorIs(res, 'agreement_incomplete'), why(res));
  res = await save(seller, visit, content({ follow_up_on: null }), true);
  check('a follow-up date when there are agreements', errorIs(res, 'follow_up_required'), why(res));
  res = await seller.client.from('sales_actas').select('registered_at').eq('activity_id', visit).maybeSingle();
  check('a refused registration leaves it a draft', !res.error && (res.data === null || res.data.registered_at === null), why(res));

  console.log('\nRegistering');
  res = await save(seller, visit, content(), true);
  check('complete, its salesperson registers it', !res.error, why(res));
  res = await save(seller, visit, content(), false);
  check('and it cannot be saved again', errorIs(res, 'acta_registered'), why(res));
  res = await save(boss, visit, content(), true);
  check('not even by an Admin', errorIs(res, 'acta_registered'), why(res));
  res = await seller.client
    .from('sales_actas')
    .select(`
      activity_id, salesperson_name, registered_at,
      customer:customers ( id, company_name ), prospect:prospects ( id, company_name ),
      registrar:profiles!sales_actas_registered_by_fkey ( name, email ),
      attendees:sales_acta_attendees ( side, name, role ),
      points:sales_acta_points ( title, topic_id, agreements:sales_acta_agreements!sales_acta_agreements_point_id_fkey ( id, responsible_name, due_on, results:sales_acta_agreement_results ( result ) ) ),
      entries:sales_acta_entries ( id, author:profiles!sales_acta_entries_created_by_fkey ( name, email ) )
    `)
    .eq('activity_id', visit)
    .single();
  const acta = res.data;
  check('it reads whole, in the customer\'s file', !res.error && acta.customer?.id === customer.id && acta.points[0].agreements.length === 1 && acta.attendees.length === 2, why(res));
  check('our attendee carries their name; theirs, their role', acta?.attendees.some((a) => a.side === 'ours' && a.name === 'ZZ seller') && acta?.attendees.some((a) => a.side === 'theirs' && a.role === 'Dueña'), JSON.stringify(acta?.attendees));
  res = await other.client.from('sales_actas').select('activity_id').eq('activity_id', visit);
  check('everyone in sales reads it', res.data?.length === 1, why(res));
  res = await plain.client.from('sales_actas').select('activity_id').eq('activity_id', visit);
  check('nobody outside sales does', res.data?.length === 0, why(res));
  res = await plain.client.from('sales_acta_points').select('id').eq('activity_id', visit);
  check('nor its points', res.data?.length === 0, why(res));

  console.log('\nAfterwards');
  const agreementId = acta.points[0].agreements[0].id;
  const entry = (who, over) => who.client.rpc('sales_acta_entry_add', {
    p_activity_id: visit, p_kind: 'followup', p_entry_date: day(0), p_body: 'Revisado con el cliente', p_closes: true, p_next_on: null, p_results: [], ...over,
  });
  res = await entry(seller, { p_kind: 'addendum', p_body: 'Pidieron también muestras', p_results: null });
  check('something is added underneath', !res.error, why(res));
  res = await entry(other, { p_kind: 'addendum', p_body: 'x', p_results: null });
  check('only by its salesperson or a manager', errorIs(res, 'not_authorized'), why(res));
  res = await entry(seller, {});
  check('a follow-up marks every agreement', errorIs(res, 'result_required'), why(res));
  res = await entry(seller, { p_results: [{ agreement_id: agreementId, result: 'partly', comment: '' }] });
  check('and says what was missing when not met', errorIs(res, 'result_comment_required'), why(res));
  res = await entry(seller, { p_closes: false, p_next_on: day(10), p_results: [{ agreement_id: agreementId, result: 'partly', comment: 'Falta el precio de la salsa' }] });
  check('it can continue on another date', !res.error, why(res));
  res = await seller.client.from('sales_acta_follow_up_state').select('due_on, closed').eq('activity_id', visit).single();
  check('which becomes when it is due', res.data?.due_on === day(10) && res.data?.closed === false, why(res));
  res = await entry(boss, { p_results: [{ agreement_id: agreementId, result: 'met', comment: null }] });
  check('an Admin closes it', !res.error, why(res));
  res = await entry(seller, {});
  check('nothing more is followed up once closed', errorIs(res, 'follow_up_closed'), why(res));

  console.log('\nA prospect that is won');
  const meeting = await plan(seller, kind.appointment, { prospect: prospect.id });
  await done(seller, meeting);
  res = await save(seller, meeting, content(), true);
  check('a meeting with a prospect is registered in the prospect\'s file', !res.error, why(res));
  const owedVisit = await plan(seller, kind.visit, { prospect: prospect.id }, day(-1));
  await done(seller, owedVisit);
  res = await seller.client.rpc('sales_prospect_win', { p_prospect_id: prospect.id });
  check('the prospect is won', !res.error && !!res.data, why(res));
  const wonCustomer = res.data;
  if (wonCustomer) created.customers.push(wonCustomer);
  res = await seller.client.from('sales_actas').select('customer_id, prospect_id').eq('activity_id', meeting).single();
  check('its Acta is in the new customer\'s file', res.data?.customer_id === wonCustomer && res.data?.prospect_id === null, why(res));
  res = await save(seller, owedVisit, content(), true);
  check('an Acta still owed from then is written afterwards', !res.error, why(res));
  res = await seller.client.from('sales_actas').select('customer_id, prospect_id').eq('activity_id', owedVisit).single();
  check('and goes to the customer\'s file too', res.data?.customer_id === wonCustomer && res.data?.prospect_id === null, why(res));

  console.log('\nThe topics');
  res = await plain.client.from('sales_acta_topics').select('id');
  check('are not read outside sales', res.data?.length === 0, why(res));
  res = await seller.client.from('sales_acta_topics').insert({ slug: 'zz-test', name: 'ZZ' }).select('id');
  check('are Admin\'s to change', !!res.error || !res.data?.length, why(res));
}

async function cleanup() {
  // Activities take their Actas with them.
  for (const id of created.activities) await admin.from('sales_activities').delete().eq('id', id);
  for (const id of created.prospects) await admin.from('prospects').delete().eq('id', id);
  for (const id of created.customers) await admin.from('customers').delete().eq('id', id);
  await admin.from('sales_acta_topics').delete().eq('slug', 'zz-test');
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
