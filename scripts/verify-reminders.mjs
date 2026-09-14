/**
 * End-to-end verification of Reminders and Personal Tasks against the real
 * database.
 *
 *   node scripts/verify-reminders.mjs            # permissions, privacy, lifecycle
 *   node scripts/verify-reminders.mjs --notify   # also calls the deployed notifier
 *
 * NOT a unit test. src/domain/reminders/*.test.ts covers the time arithmetic
 * and the notification policy; this checks the half that exists only in
 * Postgres — RLS, the reminder_* functions, column privileges — as REAL
 * signed-in users through the anon key, the same path a browser takes.
 *
 * Six throwaway accounts are created and removed. Every reminder and personal
 * task they create goes with them (ON DELETE CASCADE on the creator/owner).
 * Existing records are only READ, to link to.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WITH_NOTIFY = process.argv.includes('--notify');

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

/** Denial arrives as an error OR as an empty result — RLS filters rows. */
function denied(res) {
  return Boolean(res.error) || res.data === null || (Array.isArray(res.data) && res.data.length === 0);
}

const errorIs = (res, code) => Boolean(res.error?.message?.includes(code));

async function makeUser(role, label = role) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-rem-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: up, error } = await anon.auth.signUp({
    email, password: PW, options: { data: { name: `ZZ ${label}` } },
  });
  if (error) throw new Error('signUp: ' + error.message);
  await admin.from('profiles').update({ status: 'approved', role }).eq('id', up.user.id);
  const { data: si, error: siError } = await anon.auth.signInWithPassword({ email, password: PW });
  if (siError) throw new Error('signIn: ' + siError.message);
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + si.session.access_token } },
  });
  return { id: up.user.id, email, client, role, label };
}

const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

function save(who, over = {}) {
  return who.client.rpc('reminder_save', {
    p_id: null,
    p_title: 'ZZ reminder',
    p_notes: null,
    p_due_at: inHours(24),
    p_timezone: 'Europe/Zurich',
    p_recurrence: 'none',
    p_notify_before: null,
    p_link_type: null,
    p_link_id: null,
    p_participants: [],
    ...over,
  });
}

const created = { users: [] };

async function main() {
  const A = await makeUser('admin');
  const M = await makeUser('manager');
  const M2 = await makeUser('manager', 'manager2');
  const P = await makeUser('power_user');
  const U = await makeUser('user');
  created.users.push(A.id, M.id, M2.id, P.id, U.id);

  console.log('\n=== 1. Every approved account can use reminders, whatever its role ===');
  for (const who of [A, M, P, U]) {
    const { data } = await who.client.rpc('can_use_reminders');
    check(`${who.role} can_use_reminders() = true`, data === true, `got ${data}`);
  }
  const { data: stillInCatalog } = await admin.from('permission_catalog').select('key').eq('key', 'reminders.use');
  check('the old reminders.use capability is gone from the matrix', (stillInCatalog ?? []).length === 0);

  console.log('\n=== 2. A plain USER has reminders and personal tasks of their own ===');
  const userReminder = await save(U, { p_title: 'ZZ Check the cold room thermometer' });
  check('user CAN create a reminder', !userReminder.error, userReminder.error?.message);
  check('...and sees it', !denied(await U.client.from('reminders').select('id').eq('id', userReminder.data)));
  check('...which a manager CANNOT see', denied(await M.client.from('reminders').select('id').eq('id', userReminder.data)));
  check('...nor an admin', denied(await A.client.from('reminders').select('id').eq('id', userReminder.data)));
  const userTask = await U.client.from('personal_tasks').insert({ owner_id: U.id, title: 'ZZ user task' }).select('id').single();
  check('user CAN create a personal task', !userTask.error, userTask.error?.message);
  check('...which a manager CANNOT see', denied(await M.client.from('personal_tasks').select('id').eq('id', userTask.data?.id)));
  const { data: candidates } = await U.client.rpc('reminder_participant_candidates');
  check('user CAN list who to share with — including managers',
    (candidates ?? []).some((c) => c.id === M.id), `${candidates?.length} people`);
  check('a user still CANNOT touch operational tasks',
    denied(await U.client.from('tasks').insert({ title: 'ZZ Task user', frequency: 'weekly', schedule_config: { kind: 'weekly', weekday: 2 } }).select()));

  console.log('\n=== 3. A personal reminder is private — admins included ===');
  const mine = await save(P, { p_title: 'ZZ Call Carlos about replacement' });
  check('power user CAN create a personal reminder', !mine.error && typeof mine.data === 'string', mine.error?.message);
  const rid = mine.data;

  const own = await P.client.from('reminders').select('id, is_shared, status').eq('id', rid).single();
  check('...and sees it, as personal', own.data?.is_shared === false && own.data?.status === 'open');
  check('a manager CANNOT see it', denied(await M.client.from('reminders').select('id').eq('id', rid)));
  check('an ADMIN CANNOT see it either', denied(await A.client.from('reminders').select('id').eq('id', rid)));
  check('a manager CANNOT complete it', errorIs(await M.client.rpc('reminder_complete', { p_id: rid, p_next_due_at: null }), 'reminder_not_found'));
  check('a manager CANNOT snooze it', errorIs(await M.client.rpc('reminder_snooze', { p_id: rid, p_until: inHours(2) }), 'reminder_not_found'));
  check('nobody writes reminders directly, not even the owner',
    denied(await P.client.from('reminders').update({ title: 'ZZ hijack' }).eq('id', rid).select()));
  check('nobody inserts reminders directly',
    denied(await P.client.from('reminders').insert({ created_by: P.id, title: 'ZZ direct', due_at: inHours(1) }).select()));
  check('nobody adds themselves as a participant directly',
    denied(await M.client.from('reminder_participants').insert({ reminder_id: rid, user_id: M.id }).select()));
  check('a manager cannot read its history', denied(await M.client.from('reminder_events').select('id').eq('reminder_id', rid)));

  console.log('\n=== 4. Edit, snooze, complete ===');
  const edit = await P.client.rpc('reminder_save', {
    p_id: rid, p_title: 'ZZ Call Carlos — edited', p_notes: 'about the replacement', p_due_at: inHours(26),
    p_timezone: 'Europe/Zurich', p_recurrence: 'none', p_notify_before: 15, p_link_type: null, p_link_id: null,
    p_participants: [],
  });
  check('the creator CAN edit', !edit.error, edit.error?.message);

  check('a snooze into the past is refused', errorIs(await P.client.rpc('reminder_snooze', { p_id: rid, p_until: inHours(-1) }), 'snooze_in_past'));
  const until = inHours(30);
  check('a snooze into the future is accepted', !(await P.client.rpc('reminder_snooze', { p_id: rid, p_until: until })).error);
  const snoozed = await P.client.from('reminders').select('due_at, snoozed_until, next_at').eq('id', rid).single();
  check('...moves next_at without rewriting due_at',
    new Date(snoozed.data.next_at).getTime() === new Date(until).getTime()
      && new Date(snoozed.data.due_at).getTime() !== new Date(until).getTime());
  const { count: reminderRows } = await admin.from('reminders').select('id', { count: 'exact', head: true }).eq('created_by', P.id);
  check('...and does not create a second reminder', reminderRows === 1, `${reminderRows} rows`);

  check('complete works', !(await P.client.rpc('reminder_complete', { p_id: rid, p_next_due_at: null })).error);
  const done = await P.client.from('reminders').select('status, completed_at').eq('id', rid).single();
  check('...and keeps it, as completed', done.data?.status === 'completed' && Boolean(done.data?.completed_at));
  check('a completed reminder cannot be snoozed', errorIs(await P.client.rpc('reminder_snooze', { p_id: rid, p_until: inHours(5) }), 'reminder_closed'));

  const { data: events } = await P.client.from('reminder_events').select('action').eq('reminder_id', rid).order('created_at');
  const actions = (events ?? []).map((e) => e.action);
  check('history records created, edited, snoozed, completed',
    ['created', 'edited', 'snoozed', 'completed'].every((a) => actions.includes(a)), actions.join(','));

  console.log('\n=== 5. Shared reminders ===');
  const withUser = await save(M, { p_title: 'ZZ Tell the floor about the new labels', p_participants: [U.id] });
  check('a USER CAN be added as a participant', !withUser.error, withUser.error?.message);
  check('...and sees the shared reminder', !denied(await U.client.from('reminders').select('id').eq('id', withUser.data)));

  const pending = await makeUser('user', 'pending');
  created.users.push(pending.id);
  await admin.from('profiles').update({ status: 'pending' }).eq('id', pending.id);
  check('an account that is NOT approved cannot be added',
    errorIs(await save(M, { p_participants: [pending.id] }), 'participant_not_eligible'));

  const shared = await save(M, { p_title: 'ZZ Check DHL claim before Friday', p_participants: [P.id, A.id] });
  check('a manager CAN share with exactly the people chosen', !shared.error, shared.error?.message);
  const sid = shared.data;

  const seenByP = await P.client.from('reminders').select('id, is_shared').eq('id', sid).single();
  check('a chosen participant sees it, as shared', seenByP.data?.is_shared === true);
  check('the chosen admin sees it', !denied(await A.client.from('reminders').select('id').eq('id', sid)));
  check('a manager NOT chosen does NOT see it', denied(await M2.client.from('reminders').select('id').eq('id', sid)));

  const { data: parts } = await P.client.from('reminder_participants').select('user_id').eq('reminder_id', sid);
  check('participants see each other, creator included',
    (parts ?? []).length === 3 && [M.id, P.id, A.id].every((id) => parts.some((p) => p.user_id === id)));

  const cols = await admin.from('reminders').select('*').eq('id', sid).single();
  check('nothing on the row names a responsible person',
    !Object.keys(cols.data).some((k) => /assign|responsible|owner/i.test(k)), Object.keys(cols.data).join(','));

  check('a participant who did not create it CANNOT edit it',
    errorIs(await P.client.rpc('reminder_save', {
      p_id: sid, p_title: 'ZZ hijack', p_notes: null, p_due_at: inHours(5), p_timezone: 'Europe/Zurich',
      p_recurrence: 'none', p_notify_before: null, p_link_type: null, p_link_id: null, p_participants: [P.id],
    }), 'not_authorized'));
  check('...CANNOT cancel it', errorIs(await P.client.rpc('reminder_cancel', { p_id: sid }), 'not_authorized'));
  check('...CAN snooze it', !(await P.client.rpc('reminder_snooze', { p_id: sid, p_until: inHours(3) })).error);

  const removeA = await M.client.rpc('reminder_save', {
    p_id: sid, p_title: 'ZZ Check DHL claim before Friday', p_notes: null, p_due_at: inHours(48),
    p_timezone: 'Europe/Zurich', p_recurrence: 'none', p_notify_before: null, p_link_type: null, p_link_id: null,
    p_participants: [P.id, M2.id],
  });
  check('the creator CAN change the participants', !removeA.error, removeA.error?.message);
  check('...the removed admin no longer sees it', denied(await A.client.from('reminders').select('id').eq('id', sid)));
  check('...the added manager now does', !denied(await M2.client.from('reminders').select('id').eq('id', sid)));
  const { data: shareEvents } = await M.client.from('reminder_events').select('action').eq('reminder_id', sid);
  check('...and both changes are in the history',
    (shareEvents ?? []).some((e) => e.action === 'participant_added')
      && (shareEvents ?? []).some((e) => e.action === 'participant_removed'));

  check('a shared reminder CANNOT be converted to a personal task',
    errorIs(await M.client.rpc('reminder_convert', { p_id: sid }), 'shared_cannot_convert'));

  check('a participant CAN complete it', !(await P.client.rpc('reminder_complete', { p_id: sid, p_next_due_at: null })).error);
  const sharedDone = await M.client.from('reminders').select('status').eq('id', sid).single();
  check('...and every participant sees it completed', sharedDone.data?.status === 'completed');

  console.log('\n=== 6. Recurring reminders ===');
  const due = new Date(Date.now() + 3600_000);
  const weekly = await save(P, { p_title: 'ZZ Did I reply to the supplier?', p_recurrence: 'weekly', p_due_at: due.toISOString() });
  check('a weekly reminder can be created', !weekly.error, weekly.error?.message);
  const wid = weekly.data;
  const w0 = await P.client.from('reminders').select('recurrence_anchor, due_at').eq('id', wid).single();
  check('...anchored at its first occurrence', new Date(w0.data.recurrence_anchor).getTime() === due.getTime());

  check('completing with no later occurrence is refused',
    errorIs(await P.client.rpc('reminder_complete', { p_id: wid, p_next_due_at: due.toISOString() }), 'invalid_next_occurrence'));

  const next = new Date(due.getTime() + 7 * 86400_000).toISOString();
  check('completing an occurrence is accepted', !(await P.client.rpc('reminder_complete', { p_id: wid, p_next_due_at: next })).error);
  const w1 = await P.client.from('reminders').select('status, due_at').eq('id', wid).single();
  check('...stays open and advances to the next occurrence',
    w1.data.status === 'open' && new Date(w1.data.due_at).getTime() === new Date(next).getTime());
  const { data: wEvents } = await P.client.from('reminder_events').select('action').eq('reminder_id', wid);
  check('...recorded as an occurrence, not a completion',
    (wEvents ?? []).some((e) => e.action === 'occurrence_completed') && !(wEvents ?? []).some((e) => e.action === 'completed'));

  check('cancelling stops the series', !(await P.client.rpc('reminder_cancel', { p_id: wid })).error);
  const w2 = await P.client.from('reminders').select('status').eq('id', wid).single();
  check('...kept, as cancelled', w2.data?.status === 'cancelled');

  console.log('\n=== 7. Linked entities — by id, never copied ===');
  const firstId = async (table) => (await admin.from(table).select('id').limit(1).maybeSingle()).data?.id ?? null;
  const targets = {
    customer: await firstId('customers'),
    order: await firstId('orders'),
    incident: await firstId('incidents'),
    goods_reception: await firstId('goods_receptions'),
    task: await firstId('tasks'),
    inventory: await firstId('inventory_instances'),
    product: await firstId('products'),
  };
  const column = {
    customer: 'customer_id', order: 'order_id', incident: 'incident_id', goods_reception: 'goods_reception_id',
    task: 'task_id', inventory: 'inventory_instance_id', product: 'product_id',
  };
  for (const [type, id] of Object.entries(targets)) {
    if (!id) { console.log(`  SKIP  no ${type} exists to link to`); continue; }
    const res = await save(M, { p_title: `ZZ linked ${type}`, p_link_type: type, p_link_id: id });
    if (res.error) { check(`link to ${type}`, false, res.error.message); continue; }
    const row = await admin.from('reminders').select('*').eq('id', res.data).single();
    const set = Object.values(column).filter((c) => row.data[c]);
    check(`link to ${type} stores only its id`, row.data[column[type]] === id && set.length === 1);
  }
  check('an unknown link type is refused', errorIs(await save(M, { p_link_type: 'invoice', p_link_id: targets.order ?? M.id }), 'invalid_link'));
  check('a link to nothing is refused', Boolean((await save(M, { p_link_type: 'order', p_link_id: '00000000-0000-0000-0000-000000000000' })).error));

  console.log('\n=== 8. Reminder -> Personal Task, never an operational task ===');
  const [{ count: tasksBefore }, { count: occBefore }] = await Promise.all([
    admin.from('tasks').select('id', { count: 'exact', head: true }),
    admin.from('task_occurrences').select('id', { count: 'exact', head: true }),
  ]);

  const toConvert = await save(P, {
    p_title: 'ZZ Ask Freddy about packaging test',
    p_link_type: targets.order ? 'order' : null,
    p_link_id: targets.order,
  });
  check('a manager cannot convert somebody else\'s reminder',
    errorIs(await M.client.rpc('reminder_convert', { p_id: toConvert.data }), 'reminder_not_found'));
  const conv = await P.client.rpc('reminder_convert', { p_id: toConvert.data });
  check('the owner CAN convert it', !conv.error && typeof conv.data === 'string', conv.error?.message);
  const ptid = conv.data;

  const pt = await P.client.from('personal_tasks').select('*').eq('id', ptid).single();
  check('the result is a personal task owned by the converter',
    pt.data?.owner_id === P.id && pt.data?.title === 'ZZ Ask Freddy about packaging test' && pt.data?.source_reminder_id === toConvert.data);
  check('...carrying the same link id, not a copy', !targets.order || pt.data?.order_id === targets.order);

  const convRow = await P.client.from('reminders').select('status, personal_task_id, converted_at').eq('id', toConvert.data).single();
  check('the reminder is kept, marked converted, pointing at the task',
    convRow.data?.status === 'converted' && convRow.data?.personal_task_id === ptid && Boolean(convRow.data?.converted_at));

  const [{ count: tasksAfter }, { count: occAfter }] = await Promise.all([
    admin.from('tasks').select('id', { count: 'exact', head: true }),
    admin.from('task_occurrences').select('id', { count: 'exact', head: true }),
  ]);
  check('NO operational task was created', tasksAfter === tasksBefore, `${tasksBefore} -> ${tasksAfter}`);
  check('NO task occurrence was created — operational statistics cannot change', occAfter === occBefore, `${occBefore} -> ${occAfter}`);
  const { data: titled } = await admin.from('tasks').select('id').ilike('title', 'ZZ Ask Freddy%');
  check('...and nothing by that title exists among operational tasks', (titled ?? []).length === 0);

  check('the conversion is in the history',
    ((await P.client.from('reminder_events').select('action').eq('reminder_id', toConvert.data)).data ?? []).some((e) => e.action === 'converted'));

  console.log('\n=== 9. Personal tasks are the owner\'s alone ===');
  check('a manager CANNOT see it', denied(await M.client.from('personal_tasks').select('id').eq('id', ptid)));
  check('an admin CANNOT see it', denied(await A.client.from('personal_tasks').select('id').eq('id', ptid)));
  check('a manager CANNOT complete it',
    denied(await M.client.from('personal_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', ptid).select()));
  check('nobody can create one for somebody else',
    denied(await P.client.from('personal_tasks').insert({ owner_id: M.id, title: 'ZZ for you' }).select()));
  check('the owner CANNOT forge where it came from (column privilege)',
    Boolean((await P.client.from('personal_tasks').update({ source_reminder_id: sid }).eq('id', ptid).select()).error));
  check('the owner CANNOT hand it to someone else',
    Boolean((await P.client.from('personal_tasks').update({ owner_id: M.id }).eq('id', ptid).select()).error));
  const ptDone = await P.client.from('personal_tasks')
    .update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', ptid).select('status').single();
  check('the owner CAN complete it', ptDone.data?.status === 'completed', ptDone.error?.message);
  check('completion must be stamped consistently',
    Boolean((await P.client.from('personal_tasks').update({ status: 'cancelled' }).eq('id', ptid).select()).error));
  check('nobody deletes a personal task, the owner included',
    denied(await P.client.from('personal_tasks').delete().eq('id', ptid).select()));

  console.log('\n=== 10. Lists, search and overdue ===');
  const late = await save(P, { p_title: 'ZZ Check whether the replacement arrived', p_due_at: inHours(-3) });
  const { data: overdueList } = await P.client.rpc('list_reminders', { p_view: 'overdue' });
  check('an overdue reminder is listed as overdue, not removed', (overdueList ?? []).some((r) => r.id === late.data));
  const { data: count } = await P.client.rpc('reminder_attention_count');
  check('...and counts towards the nav badge', count >= 1, `count ${count}`);
  const { data: searched } = await P.client.rpc('list_reminders', { p_view: 'overdue', p_query: 'replacement arrived' });
  check('search by title finds it', (searched ?? []).length === 1 && searched[0].id === late.data);
  const { data: byPerson } = await P.client.rpc('list_reminders', { p_view: 'completed', p_query: 'ZZ manager2' });
  check('search by participant finds the shared reminder', (byPerson ?? []).some((r) => r.id === sid));
  const { data: othersList } = await M.client.rpc('list_reminders', { p_view: 'overdue', p_query: 'replacement arrived' });
  check('another user\'s search never finds it', (othersList ?? []).length === 0);
  const { data: pct } = await P.client.rpc('list_reminders', { p_view: 'overdue', p_query: '%' });
  check('a % in the search is literal, not a wildcard', (pct ?? []).length === 0);

  console.log('\n=== 11. The notification ledger is the scheduler\'s only ===');
  check('a user cannot read it', denied(await P.client.from('reminder_notifications').select('id').limit(1)));
  check('a user cannot write it',
    denied(await P.client.from('reminder_notifications').insert({ reminder_id: late.data, kind: 'due', slot_at: inHours(-3) }).select()));

  console.log('\n=== 12. A deactivated account loses access ===');
  await admin.from('profiles').update({ status: 'deactivated' }).eq('id', P.id);
  check('a deactivated account loses sight of its reminders', denied(await P.client.from('reminders').select('id').limit(1)));
  check('...and of its personal tasks', denied(await P.client.from('personal_tasks').select('id').limit(1)));
  check('...and cannot create', errorIs(await save(P), 'not_authorized'));
  await admin.from('profiles').update({ status: 'approved' }).eq('id', P.id);
  check('...and regains everything when approved again', !denied(await P.client.from('reminders').select('id').limit(1)));

  if (WITH_NOTIFY) {
    console.log('\n=== 13. The deployed notifier (--notify) ===');
    const appUrl = process.env.APP_URL ?? 'https://operation-management-orcin.vercel.app';
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      check('CRON_SECRET is set to call the notifier', false);
    } else {
      const soon = await save(P, { p_title: 'ZZ due right now', p_due_at: new Date(Date.now() - 60_000).toISOString() });
      const res = await fetch(`${appUrl}/api/cron/reminders`, { headers: { Authorization: `Bearer ${secret}` } });
      const body = await res.json().catch(() => ({}));
      check('the notifier answers', res.ok && body.ok === true, JSON.stringify(body).slice(0, 120));
      const { data: ledger } = await admin.from('reminder_notifications').select('kind, step').eq('reminder_id', soon.data);
      check('a due reminder is claimed as a due alert', (ledger ?? []).some((l) => l.kind === 'due'), JSON.stringify(ledger));
      const again = await fetch(`${appUrl}/api/cron/reminders`, { headers: { Authorization: `Bearer ${secret}` } });
      await again.json().catch(() => ({}));
      const { data: ledger2 } = await admin.from('reminder_notifications').select('id').eq('reminder_id', soon.data);
      check('running it again does not send it again', (ledger2 ?? []).length === (ledger ?? []).length);

      await P.client.rpc('reminder_snooze', { p_id: soon.data, p_until: new Date(Date.now() + 1000).toISOString() });
      await new Promise((r) => setTimeout(r, 1500));
      await (await fetch(`${appUrl}/api/cron/reminders`, { headers: { Authorization: `Bearer ${secret}` } })).json().catch(() => ({}));
      const { data: ledger3 } = await admin.from('reminder_notifications').select('kind, slot_at').eq('reminder_id', soon.data);
      check('a snoozed reminder gets a fresh due alert at its new time',
        (ledger3 ?? []).filter((l) => l.kind === 'due').length === 2, JSON.stringify(ledger3));
      const unauthorised = await fetch(`${appUrl}/api/cron/reminders`);
      check('the notifier refuses a call without the secret', unauthorised.status === 401);
    }
  }
}

async function cleanup() {
  for (const id of created.users) {
    // Explicit, rather than trusting the cascade: a leftover ZZ reminder
    // shared with a real person would be visible to them.
    await admin.from('reminders').delete().eq('created_by', id);
    await admin.from('personal_tasks').delete().eq('owner_id', id);
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
