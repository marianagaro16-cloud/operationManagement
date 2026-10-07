'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { TEAMS } from '@/lib/authz';
import type { ActionResult } from './actions';
import { HR_ALLOWED_MIME, HR_BUCKET, HR_MAX_BYTES } from '@/lib/hr';
import { HR_ARRIVAL_SETTINGS, getArrivalSettings, type HrArrivalSetting } from './hr';
import { sendToHrForWorker } from './push';
import { AGREEMENT_RESULTS, NOTE_TOPICS, WARNING_LEVELS } from '@/domain/hr/note-structure';
import { localToUtc } from '@/domain/reminders/schedule';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';

/*
 * Human resources writes. Who may do what is RLS's decision (hr_can, and
 * is_admin for the lists); these only shape the input and translate errors.
 *
 * Notes and evaluations are only ever ADDED. There is no action to change or
 * remove one, and no policy that would allow it.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'invalid_time' });
const optionalText = z.string().trim().max(2000).nullable().optional().transform((v) => v || null);

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (message.includes('violates row-level security') || message.includes('not_authorized')) {
    return { ok: false, error: 'not_authorized' };
  }
  if (message.includes('hr_workers_profile_id_key')) return { ok: false, error: 'account_already_linked' };
  return { ok: false, error: message };
}

function revalidateHr(workerId?: string) {
  revalidatePath('/hr');
  if (workerId) revalidatePath(`/hr/${workerId}`);
}

/** German and English overrides of a list entry; empty means "show the Spanish". */
const translationsSchema = z
  .object({
    de: z.object({ name: z.string().trim().max(200).nullable().optional(), description: z.string().trim().max(2000).nullable().optional() }).optional(),
    en: z.object({ name: z.string().trim().max(200).nullable().optional(), description: z.string().trim().max(2000).nullable().optional() }).optional(),
  })
  .default({});

/* -------------------------------- workers ------------------------------- */

const workerSchema = z.object({
  name: z.string().trim().min(1, { message: 'name_required' }).max(200),
  team: z.enum(TEAMS),
  profile_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  position: optionalText,
  start_date: DATE.nullable().optional().transform((v) => v ?? null),
  birth_date: DATE.nullable().optional().transform((v) => v ?? null),
  phone: optionalText,
  email: optionalText,
  address: optionalText,
  emergency_contact: optionalText,
  is_active: z.boolean().default(true),
  left_on: DATE.nullable().optional().transform((v) => v ?? null),
});

export type WorkerInput = z.input<typeof workerSchema>;

export async function saveWorker(input: WorkerInput, workerId?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = workerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_worker' };

  const supabase = createClient();
  const row = {
    ...parsed.data,
    // Someone still working here has not left.
    left_on: parsed.data.is_active ? null : parsed.data.left_on,
  };

  const query = workerId
    ? supabase.from('hr_workers').update(row).eq('id', workerId).select('id').single()
    : supabase
        .from('hr_workers')
        .insert({ ...row, created_by: (await supabase.auth.getUser()).data.user?.id ?? null })
        .select('id')
        .single();

  const { data, error } = await query;
  if (error) return fail(error);
  const id = (data as { id: string }).id;
  revalidateHr(id);
  return { ok: true, data: { id } };
}

/* --------------------------------- notes -------------------------------- */

const sectionText = z.string().trim().max(10000).nullable().optional().transform((v) => v || null);

/** Who was there: an account, a worker file, or a name typed in. */
const participantSchema = z.object({
  profile_id: z.string().uuid().nullable(),
  worker_id: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(200),
});

/** One thing that was agreed: what, who is responsible and by when. */
const agreementSchema = z.object({
  body: z.string().trim().min(1, { message: 'agreement_incomplete' }).max(2000),
  responsible: participantSchema,
  due_on: DATE,
});

/** What a note says. Whether it is complete for its type is the database's check. */
const contentSchema = z.object({
  sections: z.record(z.string(), z.string().trim().max(10000)),
  warning_level: z.enum(WARNING_LEVELS).nullable(),
  topic: z.enum(NOTE_TOPICS, { message: 'topic_required' }),
  event_on: DATE.nullable(),
  event_time: TIME.nullable(),
  event_area: z.enum(TEAMS).nullable(),
  agreements: z.array(agreementSchema).max(30),
  follow_up_text: sectionText,
  follow_up_on: DATE.nullable(),
  no_follow_up_reason: sectionText,
  participants: z.array(participantSchema).max(40),
  /** What the follow-up reminder is called, in the writer's language. */
  reminder_title: z.string().trim().min(1).max(200),
});

const noteSchema = contentSchema.extend({
  worker_id: z.string().uuid(),
  type_id: z.string().uuid({ message: 'type_required' }),
  note_date: DATE,
});

const NOTE_ERRORS = [
  'section_required', 'sections_required', 'level_required', 'follow_up_required', 'follow_up_date_invalid',
  'follow_up_closed', 'already_complete', 'participant_not_found', 'type_required', 'invalid_date', 'body_required',
  'topic_required', 'event_required', 'event_date_invalid', 'agreement_required', 'agreement_incomplete',
  'result_required', 'result_comment_required',
];

function failNote(error: unknown): { ok: false; error: string } {
  const message = String((error as { message?: string })?.message ?? error);
  return { ok: false, error: NOTE_ERRORS.find((code) => message.includes(code)) ?? fail(error).error };
}

/**
 * The follow-up of a note as a reminder at 9:00 that day: for the writer and
 * for the participants who may open the file themselves, linked to the note.
 * A reminder that cannot be created never undoes the note; the note says when.
 */
async function remindFollowUp(
  supabase: ReturnType<typeof createClient>,
  noteId: string,
  followupId: string | null,
  date: string,
  title: string,
  notes: string | null,
): Promise<boolean> {
  if (date < businessToday()) return false;
  const dueAt = localToUtc(date, '09:00');
  if (!dueAt) return false;
  const { data: audience } = await supabase.rpc('hr_note_reminder_audience', { p_note_id: noteId, p_followup_id: followupId });
  const { error } = await supabase.rpc('reminder_save', {
    p_id: null,
    p_title: title,
    p_notes: notes ? notes.slice(0, 4000) : null,
    p_due_at: dueAt,
    p_timezone: BUSINESS_TZ,
    p_recurrence: 'none',
    p_notify_before: null,
    p_link_type: 'hr_note',
    p_link_id: noteId,
    p_participants: (audience ?? []) as string[],
  });
  if (error) console.error('[hr] follow-up reminder', error.message);
  else revalidatePath('/reminders');
  return !error;
}

export type NoteInput = z.input<typeof noteSchema>;

/**
 * Adds a note with the sections of its type. Files are uploaded afterwards,
 * under the returned id. `reminded` says whether its follow-up got a reminder.
 */
export async function addNote(input: NoteInput): Promise<ActionResult<{ id: string; reminded: boolean }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_note' };
  const v = parsed.data;

  const supabase = createClient();
  const { data, error } = await supabase.rpc('hr_note_add', {
    p_worker_id: v.worker_id,
    p_type_id: v.type_id,
    p_note_date: v.note_date,
    p_sections: v.sections,
    p_warning_level: v.warning_level,
    p_follow_up_text: v.follow_up_text,
    p_follow_up_on: v.follow_up_on,
    p_no_follow_up_reason: v.no_follow_up_reason,
    p_participants: v.participants,
    p_topic: v.topic,
    p_event_on: v.event_on,
    p_event_time: v.event_time,
    p_event_area: v.event_area,
    p_agreements: v.agreements,
  });
  if (error) return failNote(error);
  const id = data as string;

  const reminded = v.follow_up_on
    ? await remindFollowUp(supabase, id, null, v.follow_up_on, v.reminder_title, v.follow_up_text)
    : false;

  revalidateHr(v.worker_id);
  revalidatePath('/dashboard');
  return { ok: true, data: { id, reminded } };
}

const followUpSchema = z.discriminatedUnion('kind', [
  // What came of the follow-up: it ends here, or it continues on a new date.
  z.object({
    kind: z.literal('followup'),
    note_id: z.string().uuid(),
    worker_id: z.string().uuid(),
    entry_date: DATE,
    body: z.string().trim().min(1, { message: 'body_required' }).max(10000),
    closes: z.boolean(),
    next_text: sectionText,
    next_on: DATE.nullable(),
    /** How each agreement not yet met went. */
    results: z
      .array(z.object({ agreement_id: z.string().uuid(), result: z.enum(AGREEMENT_RESULTS), comment: sectionText }))
      .max(60),
    participants: z.array(participantSchema).max(40),
    reminder_title: z.string().trim().min(1).max(200),
  }),
  // The sections a note from before the structure lacks. Once.
  contentSchema.extend({
    kind: z.literal('completion'),
    note_id: z.string().uuid(),
    worker_id: z.string().uuid(),
    entry_date: DATE,
  }),
]);

export type FollowUpInput = z.input<typeof followUpSchema>;

/**
 * Adds an entry to a note — by its author or an Admin. The note itself is
 * never touched. The reminders of the follow-up it answers are ticked off for
 * the writer, and a new date gets a new one.
 */
export async function addFollowUp(input: FollowUpInput): Promise<ActionResult<{ reminded: boolean }>> {
  const parsed = followUpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_note' };
  const v = parsed.data;
  const nextOn = v.kind === 'followup' ? (v.closes ? null : v.next_on) : v.follow_up_on;
  const nextText = v.kind === 'followup' ? v.next_text : v.follow_up_text;

  const supabase = createClient();
  const { data, error } = await supabase.rpc('hr_note_followup_add', {
    p_note_id: v.note_id,
    p_kind: v.kind,
    p_entry_date: v.entry_date,
    p_body: v.kind === 'followup' ? v.body : null,
    p_sections: v.kind === 'completion' ? v.sections : null,
    p_warning_level: v.kind === 'completion' ? v.warning_level : null,
    p_closes: v.kind === 'followup' && v.closes,
    p_next_text: nextText,
    p_next_on: nextOn,
    p_no_follow_up_reason: v.kind === 'completion' ? v.no_follow_up_reason : null,
    p_participants: v.participants,
    p_topic: v.kind === 'completion' ? v.topic : null,
    p_event_on: v.kind === 'completion' ? v.event_on : null,
    p_event_time: v.kind === 'completion' ? v.event_time : null,
    p_event_area: v.kind === 'completion' ? v.event_area : null,
    p_agreements: v.kind === 'completion' ? v.agreements : null,
    p_results: v.kind === 'followup' ? v.results : null,
  });
  if (error) return failNote(error);

  if (v.kind === 'followup') {
    // The follow-up happened: its reminders are done. Only the writer's own
    // come back under RLS, and one that will not close is no reason to fail.
    const { data: open } = await supabase.from('reminders').select('id').eq('hr_note_id', v.note_id).eq('status', 'open');
    for (const r of (open ?? []) as { id: string }[]) {
      await supabase.rpc('reminder_complete', { p_id: r.id, p_next_due_at: null });
    }
  }
  const reminded = nextOn
    ? await remindFollowUp(supabase, v.note_id, data as string, nextOn, v.reminder_title, nextText ?? (v.kind === 'followup' ? v.body : null))
    : false;

  revalidateHr(v.worker_id);
  revalidatePath('/dashboard');
  revalidatePath('/reminders');
  return { ok: true, data: { reminded } };
}

const attachmentSchema = z.object({
  note_id: z.string().uuid(),
  storage_path: z.string().min(1).max(300),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().refine((m) => HR_ALLOWED_MIME.includes(m), { message: 'type_not_allowed' }),
  size_bytes: z.number().int().positive().max(HR_MAX_BYTES),
});

/**
 * Records a file the browser already uploaded to storage.
 *
 * The upload goes straight from the browser — a server action carries at
 * most 1 MB, less than one phone photo — and the storage policy checks the
 * note it goes under. The path must sit in that note's folder.
 */
export async function recordNoteAttachment(
  input: z.input<typeof attachmentSchema>,
  workerId: string,
): Promise<ActionResult> {
  const parsed = attachmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_file' };
  if (!parsed.data.storage_path.startsWith(`${parsed.data.note_id}/`)) return { ok: false, error: 'invalid_file' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('hr_note_attachments')
    .insert({ ...parsed.data, uploaded_by: user?.id ?? null });
  if (error) {
    // A file with no row is invisible and unreclaimable, so it goes back.
    await supabase.storage.from(HR_BUCKET).remove([parsed.data.storage_path]);
    return fail(error);
  }

  revalidateHr(workerId);
  return { ok: true, data: undefined };
}

/* ------------------------------ evaluations ----------------------------- */

const evaluationSchema = z.object({
  worker_id: z.string().uuid(),
  evaluated_on: DATE,
  comment: optionalText,
  goals: optionalText,
  scores: z
    .array(z.object({ criterion_id: z.string().uuid(), score: z.number().int().min(1).max(5), comment: optionalText }))
    .min(1, { message: 'scores_required' }),
});

export async function addEvaluation(input: z.input<typeof evaluationSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = evaluationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_evaluation' };

  const supabase = createClient();

  // The criterion's name is kept with each score, read here rather than
  // trusted from the browser, so a later rename leaves this evaluation as it was.
  const { data: criteria, error: criteriaError } = await supabase
    .from('hr_criteria')
    .select('id, name, sort_order, translations')
    .in('id', parsed.data.scores.map((s) => s.criterion_id));
  if (criteriaError) return fail(criteriaError);
  const byId = new Map(
    (criteria ?? []).map((c) => [c.id as string, c as { name: string; sort_order: number; translations: unknown }]),
  );
  if (parsed.data.scores.some((s) => !byId.has(s.criterion_id))) return { ok: false, error: 'invalid_criterion' };

  const { data: { user } } = await supabase.auth.getUser();
  const { data: evaluation, error } = await supabase
    .from('hr_evaluations')
    .insert({
      worker_id: parsed.data.worker_id,
      evaluated_on: parsed.data.evaluated_on,
      comment: parsed.data.comment,
      goals: parsed.data.goals,
      created_by: user?.id ?? null,
    })
    .select('id')
    .single();
  if (error) return fail(error);
  const id = (evaluation as { id: string }).id;

  const { error: scoresError } = await supabase.from('hr_evaluation_scores').insert(
    parsed.data.scores.map((s) => ({
      evaluation_id: id,
      criterion_id: s.criterion_id,
      criterion_name: byId.get(s.criterion_id)!.name,
      criterion_translations: byId.get(s.criterion_id)!.translations ?? {},
      sort_order: byId.get(s.criterion_id)!.sort_order,
      score: s.score,
      comment: s.comment,
    })),
  );
  // Nothing can delete an evaluation, so a failure here is reported rather
  // than undone; the evaluation stays, with its comment, and no scores.
  if (scoresError) return fail(scoresError);

  revalidateHr(parsed.data.worker_id);
  return { ok: true, data: { id } };
}

/* -------------------------- the lists (Admin) --------------------------- */

const noteTypeSchema = z.object({
  name: z.string().trim().min(1, { message: 'name_required' }).max(100),
  translations: translationsSchema,
  sort_order: z.number().int().default(100),
  is_active: z.boolean().default(true),
});

export async function saveNoteType(input: z.input<typeof noteTypeSchema>, id?: string): Promise<ActionResult> {
  const parsed = noteTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_type' };

  const supabase = createClient();
  const { error } = id
    ? await supabase.from('hr_note_types').update(parsed.data).eq('id', id)
    : await supabase.from('hr_note_types').insert({ ...parsed.data, slug: crypto.randomUUID() });
  if (error) return fail(error);

  revalidatePath('/admin/hr');
  revalidatePath('/hr', 'layout');
  return { ok: true, data: undefined };
}

const criterionSchema = z.object({
  team: z.enum(TEAMS),
  /** A template's criterion; null for the team's general ones. */
  template_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  name: z.string().trim().min(1, { message: 'name_required' }).max(100),
  description: optionalText,
  translations: translationsSchema,
  sort_order: z.number().int().default(100),
  is_active: z.boolean().default(true),
});

export async function saveCriterion(input: z.input<typeof criterionSchema>, id?: string): Promise<ActionResult> {
  const parsed = criterionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_criterion' };

  const supabase = createClient();
  const { error } = id
    ? await supabase.from('hr_criteria').update(parsed.data).eq('id', id)
    : await supabase.from('hr_criteria').insert(parsed.data);
  if (error) return fail(error);

  revalidatePath('/admin/hr');
  revalidatePath('/hr', 'layout');
  return { ok: true, data: undefined };
}

const templateSchema = z.object({
  team: z.enum(TEAMS),
  name: z.string().trim().min(1, { message: 'name_required' }).max(100),
  translations: translationsSchema,
  sort_order: z.number().int().default(100),
  is_active: z.boolean().default(true),
});

/** An evaluation template: criteria for one job of a team (RLS: is_admin). */
export async function saveEvalTemplate(input: z.input<typeof templateSchema>, id?: string): Promise<ActionResult> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_template' };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('hr_eval_templates').update(parsed.data).eq('id', id)
    : await supabase.from('hr_eval_templates').insert(parsed.data);
  if (error) return fail(error);
  revalidatePath('/admin/hr');
  revalidatePath('/hr', 'layout');
  return { ok: true, data: undefined };
}

/* ----------------------------- late arrivals ----------------------------- */

const lateSchema = z
  .object({
    arrival_date: DATE,
    expected_time: TIME,
    arrived_time: TIME,
    reason_id: z.string().uuid().nullable(),
    excused: z.boolean(),
    notified: z.boolean(),
    note: optionalText,
  })
  .refine((v) => v.arrived_time.slice(0, 5) !== v.expected_time.slice(0, 5), { message: 'on_time' });

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * Record an arrival — late, or earlier than the tolerance allows — or correct
 * one, by whoever recorded it within a day (RLS). On the unexcused one that
 * reaches the month's threshold for its kind, HR is told.
 */
export async function saveLateArrival(
  workerId: string,
  input: z.input<typeof lateSchema>,
  id?: string,
): Promise<ActionResult> {
  const parsed = lateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const settings = await getArrivalSettings();
  const early = minutesOf(parsed.data.expected_time) - minutesOf(parsed.data.arrived_time);
  // Within the tolerance before the agreed time is fine: nothing to record.
  if (early > 0 && early <= settings.hr_early_tolerance_minutes) return { ok: false, error: 'within_tolerance' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  if (id) {
    const { data, error } = await supabase.from('hr_late_arrivals').update(parsed.data).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return { ok: false, error: 'late_locked' };
  } else {
    const { error } = await supabase.from('hr_late_arrivals').insert({ ...parsed.data, worker_id: workerId, created_by: user.id });
    if (error) return fail(error);
  }

  if (!parsed.data.excused) {
    const kind = early > 0 ? 'early' : 'late';
    await alertRepeatedArrivals(workerId, parsed.data.arrival_date, kind, kind === 'early' ? settings.hr_early_alert_threshold : settings.hr_late_alert_threshold);
  }
  revalidateHr(workerId);
  return { ok: true, data: undefined };
}

/** Removed by whoever recorded it, within a day. */
export async function deleteLateArrival(workerId: string, id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('hr_late_arrivals').delete().eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'late_locked' };
  revalidateHr(workerId);
  return { ok: true, data: undefined };
}

async function alertRepeatedArrivals(workerId: string, date: string, kind: 'late' | 'early', threshold: number) {
  try {
    const supabase = createClient();
    const month = date.slice(0, 7);
    const [{ count }, { data: worker }] = await Promise.all([
      supabase
        .from('hr_late_arrivals')
        .select('id', { count: 'exact', head: true })
        .eq('worker_id', workerId)
        .eq('kind', kind)
        .eq('excused', false)
        .gte('arrival_date', `${month}-01`)
        .lt('arrival_date', nextMonth(month)),
      supabase.from('hr_workers').select('name, team, profile_id').eq('id', workerId).maybeSingle(),
    ]);
    // Exactly at the threshold: told once a month, not on every one after.
    if (!worker || !threshold || count !== threshold) return;
    const monthName = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00Z`));
    // In Spanish, like every other server-sent notification.
    await sendToHrForWorker(worker.team, worker.profile_id, {
      title: `${worker.name}: ${count} ${kind === 'early' ? 'llegadas muy tempranas' : 'llegadas tarde'} sin justificar`,
      body: `En ${monthName}.`,
      url: `/hr/${workerId}?tab=late`,
      tag: `hr-${kind}-${workerId}-${month}`,
    });
  } catch (err) {
    console.error('late arrival alert failed', err);
  }
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const lateReasonSchema = z.object({
  name: z.string().trim().min(1, { message: 'name_required' }).max(100),
  translations: translationsSchema,
  sort_order: z.number().int().default(100),
  is_active: z.boolean().default(true),
});

export async function saveLateReason(input: z.input<typeof lateReasonSchema>, id?: string): Promise<ActionResult> {
  const parsed = lateReasonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_type' };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('hr_late_reasons').update(parsed.data).eq('id', id)
    : await supabase.from('hr_late_reasons').insert({ ...parsed.data, slug: crypto.randomUUID() });
  if (error) return fail(error);
  revalidatePath('/admin/hr');
  revalidatePath('/hr', 'layout');
  return { ok: true, data: undefined };
}

/** Admin's arrival settings: the alert thresholds and the early tolerance. */
export async function setArrivalSetting(key: HrArrivalSetting, n: number): Promise<ActionResult> {
  if (!(key in HR_ARRIVAL_SETTINGS)) return { ok: false, error: 'invalid' };
  const max = key === 'hr_early_tolerance_minutes' ? 120 : 31;
  const min = key === 'hr_early_tolerance_minutes' ? 0 : 1;
  if (!Number.isInteger(n) || n < min || n > max) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { error } = await supabase.from('app_settings').upsert({ key, value: n });
  if (error) return fail(error);
  revalidatePath('/admin/hr');
  return { ok: true, data: undefined };
}

/* ---------------------------------- keys ---------------------------------- */

const keySchema = z
  .object({
    key_number: z.string().trim().min(1, { message: 'key_number_required' }).max(50),
    opens: optionalText,
    /** A worker with a file, an account without one, or someone else by name. */
    worker_id: z.string().uuid().nullable(),
    profile_id: z.string().uuid().nullable(),
    holder_name: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
    holder_detail: optionalText,
    handed_on: DATE,
    returned_on: DATE.nullable(),
    note: optionalText,
  })
  .refine((v) => [v.worker_id, v.profile_id, v.holder_name].filter(Boolean).length === 1, { message: 'holder_required' })
  .refine((v) => !v.returned_on || v.returned_on >= v.handed_on, { message: 'returned_before_handed' });

export type KeyInput = z.input<typeof keySchema>;

/** Record a key handed over, or change it — returning it is setting the day it came back. */
export async function saveKey(input: KeyInput, id?: string): Promise<ActionResult> {
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };
  // Someone with a file or an account is named by it.
  const row = { ...parsed.data, holder_detail: parsed.data.holder_name ? parsed.data.holder_detail : null, updated_by: user.id };

  if (id) {
    const { data, error } = await supabase.from('hr_keys').update(row).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return { ok: false, error: 'not_authorized' };
  } else {
    const { error } = await supabase.from('hr_keys').insert({ ...row, created_by: user.id });
    if (error) return fail(error);
  }
  revalidatePath('/hr', 'layout');
  return { ok: true, data: undefined };
}

/** Removes a row recorded by mistake. Admin only (RLS). */
export async function deleteKey(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('hr_keys').delete().eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidatePath('/hr', 'layout');
  return { ok: true, data: undefined };
}
