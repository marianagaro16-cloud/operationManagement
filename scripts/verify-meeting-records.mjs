/**
 * End-to-end verification of a meeting's record for the workers' files,
 * against the real database.
 *
 *   node scripts/verify-meeting-records.mjs
 *
 * src/domain/meetings/record.test.ts covers what the form asks for; this
 * checks the half that exists only in Postgres — who may write a draft, what a
 * record needs to be registered, who may register it into whose files, that
 * it is permanent afterwards, and who reads it — as REAL signed-in users.
 *
 * Five throwaway accounts, four worker files and three meetings are created
 * and removed. No real file or meeting is touched.
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
const created = { users: [], workers: [], meetings: [] };
let pass = 0, fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
}

const errorIs = (res, code) => Boolean(res.error?.message?.includes(code));
const why = (res) => res.error?.message ?? JSON.stringify(res.data);

async function makeUser(role, label, team) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `zz-mr-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
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

async function makeWorker(name, team, profileId = null) {
  const { data, error } = await admin.from('hr_workers').insert({ name, team, profile_id: profileId }).select('id').single();
  if (error) throw new Error('worker: ' + error.message);
  created.workers.push(data.id);
  return data.id;
}

async function makeMeeting(organizer, date) {
  const res = await organizer.client
    .from('meetings')
    .insert({
      organizer_id: organizer.id, created_by: organizer.id, title: 'ZZ Limpieza y calidad', agenda: '- Limpieza\n- Calidad',
      place: 'office', meeting_date: date, start_time: '08:30', end_time: '09:00',
    })
    .select('id')
    .single();
  if (res.error) throw new Error('meeting: ' + res.error.message);
  created.meetings.push(res.data.id);
  return res.data.id;
}

async function main() {
  // Runs Production, as the real organiser of such meetings does.
  const lead = await makeUser('production_manager', 'lead', 'production');
  const boss = await makeUser('admin', 'admin', 'operations');
  const manager = await makeUser('manager', 'manager', 'operations');
  const seller = await makeUser('power_user', 'seller', 'sales');
  const plain = await makeUser('user', 'plain', 'production');

  const w1 = await makeWorker('ZZ Operaria uno', 'production');
  const w2 = await makeWorker('ZZ Operario dos', 'production');
  const own = await makeWorker('ZZ Lead', 'production', lead.id);
  const office = await makeWorker('ZZ Oficina', 'operations');

  const meetingId = await makeMeeting(lead, day(-3));
  const person = (worker_id, profile_id = null) => ({ worker_id, profile_id, name: 'x' });
  const agreement = (over = {}) => ({ body: 'Limpiar la freidora al terminar el turno', all: true, responsible: null, due_on: day(7), ...over });
  const point = (over = {}) => ({
    title: 'Limpieza', topic: 'hygiene_safety', situation: 'La freidora quedó con restos dos días.',
    discussed: 'Se repasó el orden de limpieza.', no_agreements_reason: '', agreements: [agreement()], ...over,
  });
  const content = (over = {}) => ({
    attendees: [person(w1), person(w2), person(null, lead.id), { worker_id: null, profile_id: null, name: 'Externo Pérez' }],
    points: [point(), point({ title: 'Calidad', topic: 'quality', agreements: [agreement({ body: 'Revisar el sabor', all: false, responsible: person(w1) })] })],
    follow_up_on: day(7),
    ...over,
  });
  const save = (who, c, register, id = meetingId) => who.client.rpc('meeting_record_save', { p_meeting_id: id, p_content: c, p_register: register });

  console.log('\nThe draft');
  let res = await lead.client.from('meeting_records').insert({ meeting_id: meetingId, title: 'x', meeting_date: day(-3), start_time: '08:30', end_time: '09:00', organizer_name: 'x' });
  check('a record cannot be inserted around the function', Boolean(res.error));
  res = await save(plain, content(), false);
  check('someone who is not the organiser cannot write it', errorIs(res, 'not_authorized'), why(res));
  res = await save(lead, { attendees: [person(w1)], points: [{ title: 'Limpieza', topic: null, situation: '', discussed: '', no_agreements_reason: '', agreements: [] }], follow_up_on: null }, false);
  check('the organiser saves an incomplete draft', !res.error, why(res));
  const { data: marked } = await admin.from('meetings').select('hr_record').eq('id', meetingId).single();
  check('…which marks the meeting as one for the files', marked?.hr_record === true);
  res = await manager.client.from('meeting_records').select('meeting_id').eq('meeting_id', meetingId);
  check('a draft is not in anybody\'s file yet', (res.data ?? []).length === 0, why(res));

  console.log('\nRegistering it');
  res = await save(lead, content({ points: [point({ situation: ' ' })] }), true);
  check('a point without its situation is refused', errorIs(res, 'point_incomplete'), why(res));
  res = await save(lead, content({ points: [point({ topic: null })] }), true);
  check('…and without its topic', errorIs(res, 'topic_required'), why(res));
  res = await save(lead, content({ points: [point({ agreements: [] })] }), true);
  check('…and with neither agreements nor the reason there are none', errorIs(res, 'agreement_required'), why(res));
  res = await save(lead, content({ points: [point({ agreements: [agreement({ all: false })] })] }), true);
  check('an agreement is everyone\'s or someone\'s', errorIs(res, 'agreement_incomplete'), why(res));
  res = await save(lead, content({ points: [point({ agreements: [agreement({ due_on: day(-10) })] })] }), true);
  check('…and not due before the meeting', errorIs(res, 'agreement_incomplete'), why(res));
  res = await save(lead, content({ follow_up_on: null }), true);
  check('with agreements a follow-up date is needed', errorIs(res, 'follow_up_required'), why(res));
  res = await save(lead, content({ attendees: [{ worker_id: null, profile_id: null, name: 'Externo Pérez' }] }), true);
  check('at least one attendee has a file', errorIs(res, 'attendee_required'), why(res));
  res = await save(lead, content({ attendees: [person(w1), person(office)] }), true);
  check('a Production manager cannot register it into another area\'s file', errorIs(res, 'files_not_allowed'), why(res));
  const { data: after } = await admin.from('meeting_records').select('registered_at').eq('meeting_id', meetingId).maybeSingle();
  check('a refused registration leaves the draft as it was', after !== null && after.registered_at === null, JSON.stringify(after));

  res = await save(lead, content(), true);
  check('the organiser registers a complete record', !res.error, why(res));
  const { data: attendees } = await admin.from('meeting_attendees').select('worker_id, profile_id, name').eq('meeting_id', meetingId);
  check('the attendees are stored with their files, the organiser by their own',
    attendees?.length === 4 && attendees.some((a) => a.worker_id === own && a.profile_id === lead.id && a.name === 'ZZ Lead')
      && attendees.some((a) => a.name === 'Externo Pérez' && !a.worker_id), JSON.stringify(attendees));
  const { data: agreed } = await admin.from('meeting_record_agreements').select('id, body, responsible_all, responsible_worker_id, responsible_name').eq('meeting_id', meetingId).order('body');
  check('its agreements are stored: one for everyone, one for a person',
    agreed?.length === 2 && agreed.some((a) => a.responsible_all && !a.responsible_name) && agreed.some((a) => !a.responsible_all && a.responsible_worker_id === w1), JSON.stringify(agreed));
  res = await save(lead, content(), false);
  check('registered, it cannot be rewritten', errorIs(res, 'record_registered'), why(res));
  res = await lead.client.rpc('meeting_set_hr_record', { p_meeting_id: meetingId, p_on: false });
  check('…nor taken out of the files', errorIs(res, 'record_registered'), why(res));

  console.log('\nReading it');
  res = await manager.client.from('meeting_records').select('title, meeting_date, organizer_name, points:meeting_record_points ( title )').eq('meeting_id', meetingId).maybeSingle();
  check('someone who may open an attendee\'s file reads it, without being at the meeting',
    res.data?.title === 'ZZ Limpieza y calidad' && res.data.points.length === 2, why(res));
  res = await manager.client.from('meetings').select('id').eq('id', meetingId);
  check('…though the meeting itself stays its organiser\'s and invitees\'', (res.data ?? []).length === 0, why(res));
  res = await plain.client.from('meeting_records').select('meeting_id').eq('meeting_id', meetingId);
  check('someone without access to files does not', (res.data ?? []).length === 0, why(res));
  res = await manager.client.from('meeting_attendees').select('meeting_id').eq('worker_id', w1);
  check('the file of an attendee lists the meeting', (res.data ?? []).length === 1, why(res));

  console.log('\nFollowing it up');
  const entry = (who, over = {}) => who.client.rpc('meeting_record_entry_add', {
    p_meeting_id: meetingId, p_kind: 'followup', p_entry_date: day(0), p_body: 'Se revisó la limpieza',
    p_closes: false, p_next_on: day(14),
    p_results: [{ agreement_id: agreed[0].id, result: 'met', comment: null }, { agreement_id: agreed[1].id, result: 'partly', comment: 'Faltó el viernes' }],
    ...over,
  });
  const state = async () => (await lead.client.from('meeting_record_follow_up_state').select('due_on, closed').eq('meeting_id', meetingId).single()).data;
  let s = await state();
  check('it starts with its own follow-up date, open', s?.due_on === day(7) && s.closed === false, JSON.stringify(s));
  res = await entry(manager);
  check('only the organiser or an Admin adds to it', errorIs(res, 'not_authorized'), why(res));
  res = await entry(lead, { p_results: [{ agreement_id: agreed[0].id, result: 'met', comment: null }] });
  check('a follow-up marks every agreement', errorIs(res, 'result_required'), why(res));
  res = await entry(lead, { p_results: [{ agreement_id: agreed[0].id, result: 'met', comment: null }, { agreement_id: agreed[1].id, result: 'not_met', comment: ' ' }] });
  check('…saying what was missing when one was not fully met', errorIs(res, 'result_comment_required'), why(res));
  res = await entry(lead);
  check('the organiser marks them and sets a new date', !res.error, why(res));
  s = await state();
  check('the follow-up moves to the new date', s?.due_on === day(14) && s.closed === false, JSON.stringify(s));
  res = await lead.client.rpc('meeting_record_entry_add', { p_meeting_id: meetingId, p_kind: 'addendum', p_entry_date: day(0), p_body: 'Se compró un cepillo nuevo', p_closes: false, p_next_on: null, p_results: null });
  check('a later note is added without touching the follow-up', !res.error, why(res));
  s = await state();
  check('…which stays where it was', s?.due_on === day(14) && s.closed === false, JSON.stringify(s));
  res = await entry(boss, { p_closes: true, p_next_on: null, p_results: [{ agreement_id: agreed[1].id, result: 'met', comment: null }] });
  check('an Admin marks what was still open and closes it', !res.error, why(res));
  res = await entry(lead, { p_closes: true, p_next_on: null, p_results: [] });
  check('nothing more is followed up once closed', errorIs(res, 'follow_up_closed'), why(res));

  console.log('\nAn organiser without access to files');
  const salesMeeting = await makeMeeting(seller, day(-1));
  res = await save(seller, content({ attendees: [person(null, seller.id)] }), false, salesMeeting);
  check('writes their draft', !res.error, why(res));
  res = await save(seller, content({ attendees: [person(null, seller.id), person(null, plain.id)] }), true, salesMeeting);
  check('but cannot register it', errorIs(res, 'files_not_allowed') || errorIs(res, 'attendee_required'), why(res));
  res = await save(boss, content({ attendees: [person(w1), person(office)] }), true, salesMeeting);
  check('an Admin registers it, into any area\'s files', !res.error, why(res));

  const ahead = await makeMeeting(lead, day(3));
  res = await save(lead, content(), false, ahead);
  check('a meeting still ahead has no record', errorIs(res, 'meeting_not_held'), why(res));
}

async function cleanup() {
  // Records first: a meeting with one cannot be removed.
  for (const id of created.meetings) {
    await admin.from('meeting_records').delete().eq('meeting_id', id);
    await admin.from('meetings').delete().eq('id', id);
  }
  for (const id of created.workers) await admin.from('hr_workers').delete().eq('id', id);
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
