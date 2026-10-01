'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { TEAMS } from '@/lib/authz';
import type { ActionResult } from './actions';
import { HR_ALLOWED_MIME, HR_BUCKET, HR_MAX_BYTES } from '@/lib/hr';
import { getLateAlertThreshold } from './hr';
import { sendToHrForWorker } from './push';

/*
 * Human resources writes. Who may do what is RLS's decision (hr_can, and
 * is_admin for the lists); these only shape the input and translate errors.
 *
 * Notes and evaluations are only ever ADDED. There is no action to change or
 * remove one, and no policy that would allow it.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
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

const noteSchema = z.object({
  worker_id: z.string().uuid(),
  type_id: z.string().uuid({ message: 'type_required' }),
  note_date: DATE,
  body: z.string().trim().min(1, { message: 'body_required' }).max(10000),
});

/** Adds a note. Files are uploaded afterwards, under the returned id. */
export async function addNote(input: z.input<typeof noteSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_note' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('hr_notes')
    .insert({ ...parsed.data, created_by: user?.id ?? null })
    .select('id')
    .single();
  if (error) return fail(error);

  revalidateHr(parsed.data.worker_id);
  return { ok: true, data: { id: (data as { id: string }).id } };
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

const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'invalid_time' });

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
  .refine((v) => v.arrived_time.slice(0, 5) > v.expected_time.slice(0, 5), { message: 'arrived_not_late' });

/**
 * Record a late arrival — or correct one, by whoever recorded it within a day
 * (RLS). On the unexcused one that reaches the month's threshold, HR is told.
 */
export async function saveLateArrival(
  workerId: string,
  input: z.input<typeof lateSchema>,
  id?: string,
): Promise<ActionResult> {
  const parsed = lateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
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

  if (!parsed.data.excused) await alertRepeatedLateness(workerId, parsed.data.arrival_date);
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

async function alertRepeatedLateness(workerId: string, date: string) {
  try {
    const supabase = createClient();
    const month = date.slice(0, 7);
    const [{ count }, threshold, { data: worker }] = await Promise.all([
      supabase
        .from('hr_late_arrivals')
        .select('id', { count: 'exact', head: true })
        .eq('worker_id', workerId)
        .eq('excused', false)
        .gte('arrival_date', `${month}-01`)
        .lt('arrival_date', nextMonth(month)),
      getLateAlertThreshold(),
      supabase.from('hr_workers').select('name, team, profile_id').eq('id', workerId).maybeSingle(),
    ]);
    // Exactly at the threshold: told once a month, not on every one after.
    if (!worker || count !== threshold) return;
    const monthName = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00Z`));
    // In Spanish, like every other server-sent notification.
    await sendToHrForWorker(worker.team, worker.profile_id, {
      title: `${worker.name}: ${count} llegadas tarde sin justificar`,
      body: `En ${monthName}.`,
      url: `/hr/${workerId}?tab=late`,
      tag: `hr-late-${workerId}-${month}`,
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

/** Admin's setting: from how many unexcused late arrivals in a month HR is told. */
export async function setLateAlertThreshold(n: number): Promise<ActionResult> {
  if (!Number.isInteger(n) || n < 1 || n > 31) return { ok: false, error: 'invalid' };
  const supabase = createClient();
  const { error } = await supabase.from('app_settings').upsert({ key: 'hr_late_alert_threshold', value: n });
  if (error) return fail(error);
  revalidatePath('/admin/hr');
  return { ok: true, data: undefined };
}
