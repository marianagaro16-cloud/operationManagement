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

  const agreement = (body, over = {}) => ({ body, responsible: { profile_id: null, worker_id: worker.id, name: 'x' }, due_on: day(7), ...over });
  // A type without a moment or agreements: recognition, training, the general one.
  const plainNote = { p_event_on: null, p_event_time: null, p_event_area: null, p_agreements: [] };
  const warningSections = { what: 'a', rule: 'b', response: 'c', consequence: 'e' };

  const add = (who, over = {}) => who.client.rpc('hr_note_add', {
    p_worker_id: worker.id,
    p_type_id: type('conversation'),
    p_note_date: day(-3),
    p_sections: { reason: 'Tiempos muertos', points: '- Acomodo del maíz' },
    p_warning_level: null,
    p_follow_up_text: 'Revisar tiempos muertos',
    p_follow_up_on: day(7),
    p_no_follow_up_reason: null,
    p_participants: [],
    p_topic: 'productivity',
    p_event_on: day(-4),
    p_event_time: '07:20',
    p_event_area: 'production',
    p_agreements: [agreement('Avisar al terminar'), agreement('Acomodar el maíz antes de las 14:00', { responsible: { profile_id: colleague.id, worker_id: null, name: 'x' } })],
    ...over,
  });

  console.log('\nWriting a note');
  const direct = await author.client.from('hr_notes').insert({
    worker_id: worker.id, type_id: type('conversation'), note_date: day(-3), body: 'x', created_by: author.id,
  });
  check('a note cannot be inserted around the sections', Boolean(direct.error));

  let res = await add(author, { p_sections: { reason: 'a', points: '  ' } });
  check('a conversation without one of its sections is refused', errorIs(res, 'section_required'), why(res));
  res = await add(author, { p_topic: null });
  check('…and without its topic', errorIs(res, 'topic_required'), why(res));
  res = await add(author, { p_topic: 'gossip' });
  check('…and with a topic that is not on the list', errorIs(res, 'topic_required'), why(res));
  res = await add(author, { p_event_time: null });
  check('…and without the time it happened', errorIs(res, 'event_required'), why(res));
  res = await add(author, { p_event_area: null });
  check('…and without the area', errorIs(res, 'event_required'), why(res));
  res = await add(author, { p_event_on: day(-1) });
  check('…and when it happened after the note', errorIs(res, 'event_date_invalid'), why(res));
  res = await add(author, { p_agreements: [] });
  check('…and without an agreement', errorIs(res, 'agreement_required'), why(res));
  res = await add(author, { p_agreements: [agreement('  ')] });
  check('…and with an agreement that says nothing', errorIs(res, 'agreement_incomplete'), why(res));
  res = await add(author, { p_agreements: [agreement('a', { responsible: null })] });
  check('…or has nobody responsible', errorIs(res, 'agreement_incomplete'), why(res));
  res = await add(author, { p_agreements: [agreement('a', { due_on: day(-10) })] });
  check('…or is due before the note', errorIs(res, 'agreement_incomplete'), why(res));
  res = await add(author, { p_follow_up_text: null, p_follow_up_on: null });
  check('…and without a follow-up', errorIs(res, 'follow_up_required'), why(res));
  res = await add(author, { p_follow_up_on: null });
  check('…and with a follow-up that has no date', errorIs(res, 'follow_up_required'), why(res));
  res = await add(author, { p_follow_up_on: day(-10) });
  check('…and with a follow-up before the note', errorIs(res, 'follow_up_date_invalid'), why(res));
  res = await add(author, { p_follow_up_text: null, p_follow_up_on: null, p_no_follow_up_reason: 'Tema cerrado' });
  check('with agreements "no follow-up needed" is not accepted', errorIs(res, 'follow_up_required'), why(res));
  const training = { p_type_id: type('training'), p_sections: { topic: 'a', reason: 'b', trainer: 'c', duration: 'd', result: 'e' }, ...plainNote };
  res = await add(author, { ...training, p_follow_up_text: null, p_follow_up_on: null, p_no_follow_up_reason: 'Ya lo domina' });
  check('…without them it is, with its reason', !res.error, why(res));
  res = await add(author, { ...training, p_agreements: [agreement('a')] });
  check('a training takes no agreements', errorIs(res, 'invalid_note'), why(res));
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

  const { data: stored } = await author.client.from('hr_notes').select('topic, event_on, event_time, event_area').eq('id', noteId).single();
  check('the note keeps its topic and the moment it happened',
    stored?.topic === 'productivity' && stored.event_on === day(-4) && stored.event_time?.startsWith('07:20') && stored.event_area === 'production', JSON.stringify(stored));
  const { data: agreed } = await author.client.from('hr_note_agreements')
    .select('id, body, responsible_name, responsible_worker_id, responsible_profile_id, due_on').eq('note_id', noteId).order('sort_order');
  check('its agreements are stored one by one, in order, with who and by when',
    agreed?.length === 2 && agreed[0].body === 'Avisar al terminar' && agreed[0].responsible_name === 'ZZ Test worker'
      && agreed[0].responsible_worker_id === worker.id && agreed[0].responsible_profile_id === subject.id
      && agreed[1].responsible_profile_id === colleague.id && agreed[1].due_on === day(7), JSON.stringify(agreed));
  const direct2 = await author.client.from('hr_note_agreements').insert({
    note_id: noteId, sort_order: 9, body: 'x', responsible_name: 'x', due_on: day(7),
  });
  check('an agreement cannot be inserted around the note', Boolean(direct2.error));
  const hiddenAgreements = await plain.client.from('hr_note_agreements').select('id').eq('note_id', noteId);
  check('someone without access to files cannot read the agreements', (hiddenAgreements.data ?? []).length === 0);

  res = await author.client.rpc('hr_note_reminder_audience', { p_note_id: noteId, p_followup_id: null });
  const audience = res.data ?? [];
  check('reminded: the writer and the participant who may open the file',
    audience.includes(author.id) && audience.includes(colleague.id), why(res));
  check('never the worker the note is about, nor someone without access to files',
    !audience.includes(subject.id) && !audience.includes(plain.id), why(res));

  res = await add(author, { p_type_id: type('warning'), p_sections: warningSections });
  check('a warning without its level is refused', errorIs(res, 'level_required'), why(res));
  res = await add(author, { p_type_id: type('warning'), p_warning_level: 'written', p_sections: warningSections });
  check('a warning with level, moment, sections and agreements is saved', !res.error, why(res));
  const recognition = { p_type_id: type('recognition'), p_sections: { what: 'a', impact: 'b', why: 'c', how: 'd' }, ...plainNote };
  res = await add(author, recognition);
  check('a recognition takes no follow-up', errorIs(res, 'invalid_note'), why(res));
  res = await add(author, { ...recognition, p_follow_up_text: null, p_follow_up_on: null, p_event_on: day(-4) });
  check('…nor a moment', errorIs(res, 'invalid_note'), why(res));
  res = await add(author, { ...recognition, p_follow_up_text: null, p_follow_up_on: null });
  check('a recognition with its topic and four sections is saved', !res.error, why(res));
  const general = { p_type_id: type('other'), p_sections: { reason: 'a', detail: 'b' }, ...plainNote };
  res = await add(author, { ...general, p_follow_up_text: null, p_follow_up_on: null });
  check('the general structure may go without agreements or a follow-up', !res.error, why(res));
  res = await add(author, { ...general, p_follow_up_text: null, p_follow_up_on: null, p_agreements: [agreement('a')] });
  check('…but not with agreements and no follow-up', errorIs(res, 'follow_up_required'), why(res));

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
    p_topic: null,
    p_event_on: null,
    p_event_time: null,
    p_event_area: null,
    p_agreements: null,
    // The first agreement was kept, the second only in part.
    p_results: [
      { agreement_id: agreed[0].id, result: 'met', comment: null },
      { agreement_id: agreed[1].id, result: 'partly', comment: 'Dos días no se acomodó' },
    ],
    ...over,
  });

  res = await follow(colleague);
  check('a colleague cannot add to someone else\'s note', errorIs(res, 'not_authorized'), why(res));
  res = await follow(author, { p_next_on: null });
  check('an entry must close the follow-up or set the next date', errorIs(res, 'follow_up_required'), why(res));
  res = await follow(author, { p_body: ' ' });
  check('…and say what happened', errorIs(res, 'body_required'), why(res));
  res = await follow(author, { p_results: [{ agreement_id: agreed[0].id, result: 'met', comment: null }] });
  check('…and mark every agreement', errorIs(res, 'result_required'), why(res));
  res = await follow(author, { p_results: [{ agreement_id: agreed[0].id, result: 'met', comment: null }, { agreement_id: agreed[1].id, result: 'not_met', comment: ' ' }] });
  check('…saying what was missing when one was not fully met', errorIs(res, 'result_comment_required'), why(res));
  res = await follow(author);
  check('the author marks the agreements and sets a new date', !res.error, why(res));
  s = await state();
  check('the follow-up moves to the new date', s?.due_on === day(14) && s.closed === false, JSON.stringify(s));
  const { data: marks } = await author.client.from('hr_note_agreement_results').select('agreement_id, result, comment').in('agreement_id', agreed.map((a) => a.id));
  check('each agreement has its result',
    marks?.length === 2 && marks.some((m) => m.agreement_id === agreed[0].id && m.result === 'met')
      && marks.some((m) => m.agreement_id === agreed[1].id && m.result === 'partly' && m.comment === 'Dos días no se acomodó'), JSON.stringify(marks));
  const hiddenMarks = await plain.client.from('hr_note_agreement_results').select('id').in('agreement_id', agreed.map((a) => a.id));
  check('…that someone without access to files cannot read', (hiddenMarks.data ?? []).length === 0);
  res = await follow(boss, { p_closes: true, p_next_on: null });
  check('an agreement already met is not marked again', errorIs(res, 'invalid_note'), why(res));
  res = await follow(boss, { p_closes: true, p_next_on: null, p_results: [{ agreement_id: agreed[1].id, result: 'met', comment: null }] });
  check('an Admin marks what was still open and closes it', !res.error, why(res));
  s = await state();
  check('it is closed', s?.closed === true, JSON.stringify(s));
  res = await follow(author, { p_closes: true, p_next_on: null, p_results: [] });
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
    p_sections: { reason: 'a', points: 'b' },
    p_warning_level: null,
    p_closes: false,
    p_next_text: 'Revisar',
    p_next_on: day(5),
    p_no_follow_up_reason: null,
    p_participants: [],
    p_topic: 'quality',
    p_event_on: day(-30),
    p_event_time: '10:00',
    p_event_area: 'operations',
    p_agreements: [agreement('Revisar la calidad', { due_on: day(5) })],
    p_results: null,
    ...over,
  });
  res = await completion({ p_sections: { reason: 'a' } });
  check('completing it asks for the sections of its type', errorIs(res, 'section_required'), why(res));
  res = await completion({ p_topic: null });
  check('…its topic', errorIs(res, 'topic_required'), why(res));
  res = await completion({ p_agreements: [] });
  check('…and its agreements', errorIs(res, 'agreement_required'), why(res));
  res = await completion();
  check('it is completed, the original text untouched', !res.error, why(res));
  const { data: given } = await author.client.from('hr_note_agreements').select('followup_id, body').eq('note_id', old.id);
  check('…its agreement stored with the entry that gave it', given?.length === 1 && given[0].followup_id === res.data, JSON.stringify(given));
  const { data: after } = await admin.from('hr_notes').select('body, sections').eq('id', old.id).single();
  check('…body as written, no sections on the note itself', after?.body === 'Se habló de tiempos muertos.' && after.sections === null);
  res = await completion();
  check('only once', errorIs(res, 'already_complete'), why(res));
  res = await author.client.rpc('hr_note_followup_add', {
    p_note_id: noteId, p_kind: 'completion', p_entry_date: day(0), p_body: null,
    p_sections: { reason: 'a', points: 'b' }, p_warning_level: null, p_closes: false,
    p_next_text: 'Revisar', p_next_on: day(5), p_no_follow_up_reason: null, p_participants: [],
    p_topic: 'quality', p_event_on: day(-30), p_event_time: '10:00', p_event_area: 'operations',
    p_agreements: [agreement('a')], p_results: null,
  });
  check('a note that has its sections is not "completed"', Boolean(res.error), why(res));

  const { data: open } = await author.client.from('hr_note_follow_up_state').select('note_id, due_on').eq('worker_id', worker.id).eq('closed', false).not('due_on', 'is', null);
  check('the open follow-ups of the file: the warning and the completed old note',
    open?.length === 2 && open.some((o) => o.note_id === old.id && o.due_on === day(5)), JSON.stringify(open));

  console.log('\nA conversation the employee asked for');
  const asked = (who, over = {}) => add(who, {
    p_asked_by: 'employee',
    p_confidential: true,
    p_sections: { raised: 'Pide cambiar al turno de mañana', answered: 'Se revisa con producción' },
    p_topic: 'schedule_leave',
    p_agreements: [],
    p_follow_up_text: null,
    p_follow_up_on: null,
    p_no_follow_up_reason: 'Se resolvió en el momento',
    ...over,
  });
  res = await asked(author, { p_sections: { reason: 'x', points: 'y' } });
  check('needs what they raised and what was answered', errorIs(res, 'section_required'), why(res));
  res = await asked(author, { p_topic: 'productivity' });
  check('has its own topics', errorIs(res, 'topic_required'), why(res));
  res = await add(author, { p_topic: 'personal' });
  check('which a conversation the company asked for does not take', errorIs(res, 'topic_required'), why(res));
  res = await asked(author, { p_no_follow_up_reason: null });
  check('needs a next step with its date, or the reason there is none', errorIs(res, 'follow_up_required'), why(res));
  res = await asked(author, { p_type_id: type('recognition') });
  check('only a conversation says who asked for it', errorIs(res, 'invalid_note'), why(res));
  res = await add(author, { p_confidential: true });
  check('only it can be confidential', errorIs(res, 'invalid_note'), why(res));
  res = await asked(author, { p_confidential: false });
  check('without the tick it is read with the file, like any note',
    !res.error && (await colleague.client.from('hr_notes').select('id').eq('id', res.data)).data?.length === 1, why(res));
  res = await colleague.client.rpc('hr_confidential_hidden', { p_worker_id: worker.id });
  check('and nothing is hidden from the colleague yet', res.data === 0, why(res));
  res = await asked(author);
  check('is saved without agreements', !res.error && !!res.data, why(res));
  const askedId = res.data;
  res = await asked(author, {
    p_agreements: [agreement('Confirmar el cambio de turno', { responsible: { profile_id: author.id, worker_id: null, name: 'x' } })],
    p_follow_up_text: 'Confirmar con producción', p_follow_up_on: day(7), p_no_follow_up_reason: null,
  });
  check('or with them, and then a follow-up', !res.error, why(res));
  const askedWithAgreement = res.data;

  const reads = async (who, table, column, id) => (await who.client.from(table).select('id').eq(column, id)).data?.length ?? 0;
  check('whoever wrote it reads it', (await reads(author, 'hr_notes', 'id', askedId)) === 1);
  check('an Admin reads it', (await reads(boss, 'hr_notes', 'id', askedId)) === 1);
  check('a colleague with the same access to the file does not', (await reads(colleague, 'hr_notes', 'id', askedId)) === 0);
  check('nor its agreements', (await reads(author, 'hr_note_agreements', 'note_id', askedWithAgreement)) === 1
    && (await reads(colleague, 'hr_note_agreements', 'note_id', askedWithAgreement)) === 0);
  check('nor who was there', (await reads(author, 'hr_note_participants', 'note_id', askedId)) >= 1
    && (await reads(colleague, 'hr_note_participants', 'note_id', askedId)) === 0);
  res = await colleague.client.from('hr_note_follow_up_state').select('note_id').eq('note_id', askedWithAgreement);
  check('nor that it has a follow-up open', res.data?.length === 0, why(res));
  res = await colleague.client.rpc('hr_note_reminder_audience', { p_note_id: askedWithAgreement });
  check('nor who is reminded of it', errorIs(res, 'not_authorized'), why(res));
  res = await colleague.client.rpc('hr_confidential_hidden', { p_worker_id: worker.id });
  check('the colleague is told two notes are hidden, not what they say', res.data === 2, why(res));
  res = await author.client.rpc('hr_confidential_hidden', { p_worker_id: worker.id });
  check('nothing is hidden from whoever wrote them', res.data === 0, why(res));
  res = await boss.client.rpc('hr_confidential_hidden', { p_worker_id: worker.id });
  check('nor from an Admin', res.data === 0, why(res));
  res = await plain.client.rpc('hr_confidential_hidden', { p_worker_id: worker.id });
  check('and whoever cannot open the file learns nothing', res.data === 0, why(res));
  res = await colleague.client.from('hr_notes').select('id').eq('worker_id', worker.id);
  check('the colleague still reads the other notes of the file', (res.data?.length ?? 0) > 0 && !res.data.some((n) => n.id === askedId), why(res));
  const { data: storedAsked } = await admin.from('hr_notes').select('asked_by').in('id', [askedId, noteId]);
  check('who asked is kept: the employee here, the company on an ordinary conversation',
    storedAsked?.map((n) => n.asked_by).sort().join() === 'company,employee', JSON.stringify(storedAsked));
  check('a confidential note says so', (await admin.from('hr_notes').select('confidential').eq('id', askedId).single()).data?.confidential === true);
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
