/**
 * End-to-end verification of the Guides against the real database.
 *
 *   node scripts/verify-guides.mjs
 *
 * NOT a unit test. src/domain/guide/guide.test.ts covers which points belong
 * to a day; this checks the half that exists only in Postgres — who may read
 * a guide and when, who writes it, and that only the person covering today
 * ticks today's points — as REAL signed-in users through the anon key.
 *
 * Six throwaway accounts are created and removed, with their guide, absence
 * and coverage (ON DELETE CASCADE) and the one article they write.
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
const created = { users: [], articles: [] };
let pass = 0, fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}
const errorIs = (res, code) => Boolean(res.error?.message?.includes(code));
const why = (res) => res.error?.message ?? JSON.stringify(res.data);
const none = (res) => Boolean(res.error) || (res.data ?? []).length === 0;

async function makeUser(role, label) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-gd-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
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

const zurich = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date(Date.now() + offset * 86400_000));
const isoDow = (date) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;

async function main() {
  const editor = await makeUser('manager', 'editor');
  const owner = await makeUser('user', 'owner');
  const coverer = await makeUser('user', 'coverer');
  const tomorrowCoverer = await makeUser('user', 'tomorrow');
  const outsider = await makeUser('user', 'outsider');
  const approver = await makeUser('admin', 'approver');
  await admin.from('absence_approvers').insert({ profile_id: approver.id });

  const today = zurich(0);
  const tomorrow = zurich(1);
  const dow = isoDow(today);
  const otherDow = (dow % 7) + 1;

  console.log('\nWriting a guide');
  let res = await owner.client.from('guides').insert({ profile_id: owner.id });
  check('a person cannot start their own guide', Boolean(res.error), why(res));
  res = await editor.client.from('guides').insert({ profile_id: owner.id, intro: 'ZZ', day_notes: { [dow]: 'ZZ day' } });
  check('a Manager starts a guide for someone', !res.error, why(res));

  const point = async (over) => {
    const r = await editor.client
      .from('guide_points')
      .insert({ guide_id: owner.id, kind: 'task', weekdays: [dow], title: 'ZZ point', sort_order: 10, ...over })
      .select('id')
      .single();
    if (r.error) throw new Error('point: ' + r.error.message);
    return r.data.id;
  };
  const todayPoint = await point({});
  const otherPoint = await point({ weekdays: [otherDow], title: 'ZZ other day' });
  const rulePoint = await point({ kind: 'rule', title: 'ZZ rule' });
  check('the Manager writes its points', Boolean(todayPoint && otherPoint && rulePoint));
  res = await editor.client.from('guide_points').insert({ guide_id: owner.id, weekdays: [], title: 'x' });
  check('a point needs at least one weekday', Boolean(res.error));

  res = await editor.client.from('guide_articles').insert({ title: 'ZZ article', topic: 'ZZ', blocks: [{ type: 'text', text: 'ZZ' }] }).select('id').single();
  check('…and an article', !res.error, why(res));
  const articleId = res.data?.id;
  if (articleId) created.articles.push(articleId);
  const { data: anySupplier } = await admin.from('suppliers').select('id').limit(1).single();

  console.log('\nWho reads');
  check('the guide\'s person reads it', !none(await owner.client.from('guide_points').select('id').eq('guide_id', owner.id)));
  check('…and the articles', !none(await owner.client.from('guide_articles').select('id').eq('id', articleId)));
  res = await owner.client.from('guide_points').update({ title: 'changed' }).eq('id', todayPoint).select('id');
  check('…but does not change it', none(res), why(res));
  check('an approver reads it', !none(await approver.client.from('guides').select('profile_id').eq('profile_id', owner.id)));
  check('anyone else reads no guide', none(await outsider.client.from('guides').select('profile_id').eq('profile_id', owner.id)));
  check('…no points', none(await outsider.client.from('guide_points').select('id').eq('guide_id', owner.id)));
  check('…no articles', none(await outsider.client.from('guide_articles').select('id').eq('id', articleId)));
  check('…no supplier ordering info', none(await outsider.client.from('supplier_order_info').select('supplier_id')));
  res = await outsider.client.from('supplier_order_info').insert({ supplier_id: anySupplier.id, how: 'x' });
  check('…and writes none', Boolean(res.error));
  res = await outsider.client.rpc('guide_access');
  check('the menu entry stays hidden for them', res.data?.edit === false && res.data.guides.length === 0, why(res));
  check('someone who will cover reads nothing before', none(await coverer.client.from('guide_points').select('id').eq('guide_id', owner.id)));

  console.log('\nCovering');
  const { data: type } = await admin.from('absence_types').select('id').limit(1).single();
  const { data: absence, error: absenceError } = await admin
    .from('absences')
    .insert({ profile_id: owner.id, type_id: type.id, start_date: today, end_date: tomorrow, created_by: approver.id })
    .select('id')
    .single();
  if (absenceError) throw new Error('absence: ' + absenceError.message);
  res = await approver.client.rpc('absence_decide', { p_absence_id: absence.id, p_approve: true });
  if (res.error) throw new Error('approve: ' + res.error.message);
  for (const [who, date] of [[coverer, today], [tomorrowCoverer, tomorrow]]) {
    const r = await admin.from('coverage_assignments').insert({ absence_id: absence.id, coverer_id: who.id, cover_date: date, start_time: '08:00', end_time: '16:00', created_by: approver.id });
    if (r.error) throw new Error('coverage: ' + r.error.message);
  }

  check('whoever covers today reads the guide', !none(await coverer.client.from('guide_points').select('id').eq('guide_id', owner.id)));
  check('…and the articles', !none(await coverer.client.from('guide_articles').select('id').eq('id', articleId)));
  res = await coverer.client.rpc('guide_access');
  check('…and is told they cover today', res.data?.guides?.[0]?.covering_today === true && res.data.edit === false, why(res));
  res = await coverer.client.from('guide_points').update({ title: 'changed' }).eq('id', todayPoint).select('id');
  check('…but does not change it', none(res), why(res));
  check('whoever covers tomorrow can read ahead', !none(await tomorrowCoverer.client.from('guide_points').select('id').eq('guide_id', owner.id)));

  const tick = (who, pointId, status, comment = null) => who.client.rpc('guide_check', { p_point_id: pointId, p_status: status, p_comment: comment });
  res = await tick(tomorrowCoverer, todayPoint, 'done');
  check('…but ticks nothing yet', errorIs(res, 'not_authorized'), why(res));
  res = await tick(owner, todayPoint, 'done');
  check('the guide\'s own person has no checklist', errorIs(res, 'not_authorized'), why(res));
  res = await tick(editor, todayPoint, 'done');
  check('nor does a Manager', errorIs(res, 'not_authorized'), why(res));
  res = await coverer.client.from('guide_checks').insert({ point_id: todayPoint, check_date: today, status: 'done' });
  check('a tick cannot be written around the function', Boolean(res.error));

  res = await tick(coverer, todayPoint, 'done', 'ZZ comment');
  check('whoever covers today ticks a point of today', !res.error, why(res));
  res = await tick(coverer, otherPoint, 'done');
  check('…not one of another weekday', errorIs(res, 'not_today'), why(res));
  res = await tick(coverer, rulePoint, 'done');
  check('…nor a rule', errorIs(res, 'not_today'), why(res));
  res = await owner.client.from('guide_checks').select('status, comment, checked_by').eq('point_id', todayPoint).eq('check_date', today);
  check('the person who is away sees it, with the comment and who did it',
    res.data?.[0]?.status === 'done' && res.data[0].comment === 'ZZ comment' && res.data[0].checked_by === coverer.id, why(res));
  res = await tick(coverer, todayPoint, 'skipped', 'ZZ no aplica');
  const { data: after } = await admin.from('guide_checks').select('status').eq('point_id', todayPoint);
  check('"not today" replaces the tick', !res.error && after?.length === 1 && after[0].status === 'skipped', why(res));
  res = await tick(coverer, todayPoint, null);
  const { data: cleared } = await admin.from('guide_checks').select('status').eq('point_id', todayPoint);
  check('…and it can be cleared again', !res.error && cleared?.length === 0, why(res));
  check('someone not involved still reads no ticks', none(await outsider.client.from('guide_checks').select('point_id').eq('point_id', todayPoint)));

  await editor.client.from('guide_points').update({ removed_at: new Date().toISOString() }).eq('id', todayPoint);
  res = await tick(coverer, todayPoint, 'done');
  check('a point taken off the guide is no longer ticked', Boolean(res.error), why(res));
}

async function cleanup() {
  for (const id of created.articles) await admin.from('guide_articles').delete().eq('id', id);
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
