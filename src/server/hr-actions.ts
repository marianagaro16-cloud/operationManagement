'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { TEAMS } from '@/lib/authz';
import type { ActionResult } from './actions';
import { HR_ALLOWED_MIME, HR_BUCKET, HR_MAX_BYTES } from '@/lib/hr';

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

/* -------------------------------- workers ------------------------------- */

const workerSchema = z.object({
  name: z.string().trim().min(1, { message: 'name_required' }).max(200),
  team: z.enum(TEAMS),
  profile_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  position: optionalText,
  start_date: DATE.nullable().optional().transform((v) => v ?? null),
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
  scores: z
    .array(z.object({ criterion_id: z.string().uuid(), score: z.number().int().min(1).max(5) }))
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
    .select('id, name, sort_order')
    .in('id', parsed.data.scores.map((s) => s.criterion_id));
  if (criteriaError) return fail(criteriaError);
  const byId = new Map((criteria ?? []).map((c) => [c.id as string, c as { name: string; sort_order: number }]));
  if (parsed.data.scores.some((s) => !byId.has(s.criterion_id))) return { ok: false, error: 'invalid_criterion' };

  const { data: { user } } = await supabase.auth.getUser();
  const { data: evaluation, error } = await supabase
    .from('hr_evaluations')
    .insert({
      worker_id: parsed.data.worker_id,
      evaluated_on: parsed.data.evaluated_on,
      comment: parsed.data.comment,
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
      sort_order: byId.get(s.criterion_id)!.sort_order,
      score: s.score,
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
  name: z.string().trim().min(1, { message: 'name_required' }).max(100),
  description: optionalText,
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
