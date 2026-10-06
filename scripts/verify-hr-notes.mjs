/**
 * End-to-end verification of structured log notes against the real database.
 *
 *   node scripts/verify-hr-notes.mjs
 *
 * NOT a unit test. src/domain/hr/note-structure.test.ts covers what the form
 * asks for; this checks the half that exists only in Postgres — that a note
 * cannot be saved without its sections, who may add to it later, where its
 * follow-up stands and who is reminded — as REAL signed-in users through the
 * anon key, the same path a browser takes.
 *
 * Five throwaway accounts and one throwaway worker file are created and
 * removed. The notes go with the file (ON DELETE CASCADE); no real file is
 * touched.
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
const created = { users: [], worker: null };
let pass = 0, fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}

const errorIs = (res, code) => Boolean(res.error?.message?.includes(code));
const why = (res) => res.error?.message ?? JSON.stringify(res.data);

async function makeUser(role, label) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-hrn-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
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
  const author = await makeUser('manager', 'author');
  const colleague = await makeUser('manager', 'colleague');
  const boss = await makeUser('admin', 'admin');
  const plain = await makeUser('user', 'plain');
  const subject = await makeUser('user', 'subject');

  const { data: worker, error: workerError } = await admin
    .from('hr_workers')
    .insert({ name: 'ZZ Test worker', team: 'operations', profile_id: subject.id })
    .select('id')
    .single();
  if (workerError) throw new Error('worker: ' + workerError.message);
  created.worker = worker.id;

  const { data: types } = await admin.from('hr_note_types').select('id, slug, structure');
  const type = (slug) => types.find((t) => t.slug === slug).id;
  check('the four built-in types have their own structure, Otro the general one',
    ['conversation', 'recognition', 'warning', 'training'].every((s) => types.find((t) => t.slug === s)?.structure === s)
      && types.find((t) => t.slug === 'other')?.structure === 'general');

  const add = (who, over = {}) => who.client.rpc('hr_note_add', {
    p_worker_id: worker.id,
    p_type_id: type('conversation'),
    p_note_date: day(-3),
    p_sections: { reason: 'Tiempos muertos', points: '- Acomodo del maíz', agreements: 'Avisar al terminar' },
    p_warning_level: null,
    p_follow_up_text: 'Revisar tiempos muertos',
    p_follow_up_on: day(7),
    p_no_follow_up_reason: null,
    p_participants: [],
    ...over,
  });

  console.log('\nWriting a note');
  const direct = await author.client.from('hr_notes').insert({
    worker_id: worker.id, type_id: type('conversation'), note_date: day(-3), body: 'x', created_by: author.id,
  });
  check('a note cannot be inserted around the sections', Boolean(direct.error));

  let res = await add(author, { p_sections: { reason: 'a', points: 'b', agreements: '  ' } });
  check('a conversation without its agreements is refused', errorIs(res, 'section_required'), why(res));
  res = await add(author, { p_follow_up_text: null, p_follow_up_on: null });
  check('…and without a follow-up or the reason there is none', errorIs(res, 'follow_up_required'), why(res));
  res = await add(author, { p_follow_up_on: null });
  check('…and with a follow-up that has no date', errorIs(res, 'follow_up_required'), why(res));
  res = await add(author, { p_follow_up_on: day(-10) });
  check('…and with a follow-up before the note', errorIs(res, 'follow_up_date_invalid'), why(res));
  res = await add(author, { p_follow_up_text: null, p_follow_up_on: null, p_no_follow_up_reason: 'Tema cerrado' });
  check('"no follow-up needed" with its reason is accepted', !res.error, why(res));
  res = await add(author, { p_note_date: day(2) });
  check('a note cannot be dated in the future', errorIs(res, 'invalid_date'), why(res));

  res = await add(author, {
    p_participants: [
      { profile_id: colleague.id, worker_id: null, name: 'x' },
      { profile_id: plain.id, worker_id: null, name: 'x' },
      { profile_id: null, worker_id: worker.id, name: 'x' },
      { profile_id: null, worker_id: null, name: 'Externo Pérez' },
      { profile_id: colleague.id, worker_id: null, name: 'twice' },
    ],
  });
  check('a complete conversation is saved', !res.error, why(res));
  const noteId = res.data;

  const { data: people } = await author.client.from('hr_note_participants').select('profile_id, worker_id, name').eq('note_id', noteId);
  check('the writer is a participant without being picked', people?.some((p) => p.profile_id === author.id));
  check('each person once, a typed name kept as written',
    people?.length === 5 && people.some((p) => p.name === 'Externo Pérez' && !p.profile_id && !p.worker_id), JSON.stringify(people));
  check('the worker picked from the file carries their account too',
    people?.some((p) => p.worker_id === worker.id && p.profile_id === subject.id && p.name === 'ZZ Test worker'));

  res = await author.client.rpc('hr_note_reminder_audience', { p_note_id: noteId, p_followup_id: null });
  const audience = res.data ?? [];
  check('reminded: the writer and the participant who may open the file',
    audience.includes(author.id) && audience.includes(colleague.id), why(res));
  check('never the worker the note is about, nor someone without access to files',
    !audience.includes(subject.id) && !audience.includes(plain.id), why(res));

  res = await add(author, { p_type_id: type('warning'), p_sections: { what: 'a', rule: 'b', response: 'c', agreements: 'd', consequence: 'e' } });
  check('a warning without its level is refused', errorIs(res, 'level_required'), why(res));
  res = await add(author, { p_type_id: type('warning'), p_warning_level: 'written', p_sections: { what: 'a', rule: 'b', response: 'c', agreements: 'd', consequence: 'e' } });
  check('a warning with level and sections is saved', !res.error, why(res));
  res = await add(author, { p_type_id: type('recognition'), p_sections: { what: 'a', impact: 'b', why: 'c', how: 'd' } });
  check('a recognition takes no follow-up', errorIs(res, 'invalid_note'), why(res));
  res = await add(author, { p_type_id: type('recognition'), p_sections: { what: 'a', impact: 'b', why: 'c', how: 'd' }, p_follow_up_text: null, p_follow_up_on: null });
  check('a recognition with its four sections is saved', !res.error, why(res));
  res = await add(author, { p_type_id: type('other'), p_sections: { reason: 'a', detail: 'b' }, p_follow_up_text: null, p_follow_up_on: null });
  check('the general structure may go without a follow-up', !res.error, why(res));

  res = await add(plain);
  check('someone without access to files cannot write a note', errorIs(res, 'not_authorized'), why(res));
  res = await add(subject);
  check('nor the worker in their own file', errorIs(res, 'not_authorized'), why(res));
  const hidden = await plain.client.from('hr_note_participants').select('id').eq('note_id', noteId);
  check('…nor read who was there', (hidden.data ?? []).length === 0);

  console.log('\nFollowing it up');
  const state = async () => (await author.client.from('hr_note_follow_up_state').select('due_on, closed').eq('note_id', noteId).single()).data;
  let s = await state();
  check('the note starts with its own follow-up date, open', s?.due_on === day(7) && s.closed === false, JSON.stringify(s));

  const follow = (who, over = {}) => who.client.rpc('hr_note_followup_add', {
    p_note_id: noteId,
    p_kind: 'followup',
    p_entry_date: day(0),
    p_body: 'Se revisó: mejoró',
    p_sections: null,
    p_warning_level: null,
    p_closes: false,
    p_next_text: null,
    p_next_on: day(14),
    p_no_follow_up_reason: null,
    p_participants: [],
    ...over,
  });

  res = await follow(colleague);
  check('a colleague cannot add to someone else\'s note', errorIs(res, 'not_authorized'), why(res));
  res = await follow(author, { p_next_on: null });
  check('an entry must close the follow-up or set the next date', errorIs(res, 'follow_up_required'), why(res));
  res = await follow(author, { p_body: ' ' });
  check('…and say what happened', errorIs(res, 'body_required'), why(res));
  res = await follow(author);
  check('the author sets a new date', !res.error, why(res));
  s = await state();
  check('the follow-up moves to the new date', s?.due_on === day(14) && s.closed === false, JSON.stringify(s));
  res = await follow(boss, { p_closes: true, p_next_on: null });
  check('an Admin closes it', !res.error, why(res));
  s = await state();
  check('it is closed', s?.closed === true, JSON.stringify(s));
  res = await follow(author, { p_closes: true, p_next_on: null });
  check('nothing more is added once closed', errorIs(res, 'follow_up_closed'), why(res));
  const edit = await author.client.from('hr_notes').update({ follow_up_text: 'changed' }).eq('id', noteId).select('id');
  check('the note itself still cannot be changed', Boolean(edit.error) || (edit.data ?? []).length === 0);

  console.log('\nA note from before the sections');
  const { data: old } = await admin
    .from('hr_notes')
    .insert({ worker_id: worker.id, type_id: type('conversation'), note_date: day(-30), body: 'Se habló de tiempos muertos.', created_by: author.id })
    .select('id')
    .single();
  const completion = (over = {}) => author.client.rpc('hr_note_followup_add', {
    p_note_id: old.id,
    p_kind: 'completion',
    p_entry_date: day(0),
    p_body: null,
    p_sections: { reason: 'a', points: 'b', agreements: 'c' },
    p_warning_level: null,
    p_closes: false,
    p_next_text: 'Revisar',
    p_next_on: day(5),
    p_no_follow_up_reason: null,
    p_participants: [],
    ...over,
  });
  res = await completion({ p_sections: { reason: 'a' } });
  check('completing it asks for the sections of its type', errorIs(res, 'section_required'), why(res));
  res = await completion();
  check('it is completed, the original text untouched', !res.error, why(res));
  const { data: after } = await admin.from('hr_notes').select('body, sections').eq('id', old.id).single();
  check('…body as written, no sections on the note itself', after?.body === 'Se habló de tiempos muertos.' && after.sections === null);
  res = await completion();
  check('only once', errorIs(res, 'already_complete'), why(res));
  res = await author.client.rpc('hr_note_followup_add', {
    p_note_id: noteId, p_kind: 'completion', p_entry_date: day(0), p_body: null,
    p_sections: { reason: 'a', points: 'b', agreements: 'c' }, p_warning_level: null, p_closes: false,
    p_next_text: null, p_next_on: null, p_no_follow_up_reason: 'x', p_participants: [],
  });
  check('a note that has its sections is not "completed"', Boolean(res.error), why(res));

  const { data: open } = await author.client.from('hr_note_follow_up_state').select('note_id, due_on').eq('worker_id', worker.id).eq('closed', false).not('due_on', 'is', null);
  check('the open follow-ups of the file: the warning and the completed old note',
    open?.length === 2 && open.some((o) => o.note_id === old.id && o.due_on === day(5)), JSON.stringify(open));
}

async function cleanup() {
  // The file first: its notes, entries and participants go with it.
  if (created.worker) await admin.from('hr_workers').delete().eq('id', created.worker);
  for (const id of created.users) {
    await admin.from('reminders').delete().eq('created_by', id);
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
