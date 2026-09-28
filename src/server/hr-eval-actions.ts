'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './actions';
import { notifyEvaluationRequested } from './hr-eval-notify';

/*
 * Evaluations sent to several people — writes.
 *
 * Every rule is the database's (hr_eval_* functions): only Admin sends and
 * manages, each evaluator answers only their own, and a submitted answer is
 * never changed. These shape the input, translate errors and tell people.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
const KNOWN_ERRORS = [
  'not_authorized', 'deadline_past', 'items_required', 'evaluators_required', 'worker_not_found',
  'invalid_criterion', 'invalid_question', 'evaluation_closed', 'already_submitted', 'rate_all',
];

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (message.includes('violates row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: KNOWN_ERRORS.find((code) => message.includes(code)) ?? message };
}

function revalidate(workerId?: string, requestId?: string) {
  if (workerId) revalidatePath(`/hr/${workerId}`);
  if (requestId) revalidatePath(`/hr/evaluations/${requestId}`);
  revalidatePath('/evaluations');
  revalidatePath('/dashboard');
}

const localized = z.object({
  name: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

const itemSchema = z.union([
  z.object({ criterion_id: z.string().uuid() }),
  z.object({
    kind: z.enum(['scale', 'text']),
    name: z.string().trim().min(1, { message: 'invalid_question' }).max(300),
    description: z.string().trim().max(2000).nullable().optional(),
    translations: z.object({ de: localized.optional(), en: localized.optional() }).default({}),
  }),
]);

const sendSchema = z.object({
  worker_id: z.string().uuid(),
  deadline: DATE,
  items: z.array(itemSchema).min(1, { message: 'items_required' }).max(60),
  evaluator_ids: z.array(z.string().uuid()).min(1, { message: 'evaluators_required' }).max(200),
});

type Invited = { assignment_id: string; evaluator_id: string }[];

async function tell(requestId: string, invited: Invited) {
  if (invited.length === 0) return;
  const supabase = createClient();
  const { data } = await supabase
    .from('hr_eval_requests')
    .select('worker_name, deadline')
    .eq('id', requestId)
    .maybeSingle();
  if (!data) return;
  for (const i of invited) {
    await notifyEvaluationRequested(i.evaluator_id, i.assignment_id, data.worker_name, data.deadline);
  }
}

export async function sendEvaluation(input: z.input<typeof sendSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_evaluation' };

  const supabase = createClient();
  const { data, error } = await supabase.rpc('hr_eval_send', {
    p_worker_id: parsed.data.worker_id,
    p_deadline: parsed.data.deadline,
    p_items: parsed.data.items,
    p_evaluators: [...new Set(parsed.data.evaluator_ids)],
  });
  if (error) return fail(error);

  const result = data as unknown as { request_id: string; assignments: Invited };
  await tell(result.request_id, result.assignments);
  revalidate(parsed.data.worker_id, result.request_id);
  return { ok: true, data: { id: result.request_id } };
}

export async function inviteEvaluators(
  requestId: string,
  workerId: string,
  evaluatorIds: string[],
): Promise<ActionResult<{ added: number }>> {
  const ids = z.array(z.string().uuid()).min(1, { message: 'evaluators_required' }).max(200).safeParse(evaluatorIds);
  if (!ids.success) return { ok: false, error: ids.error.issues[0]?.message ?? 'evaluators_required' };

  const supabase = createClient();
  const { data, error } = await supabase.rpc('hr_eval_invite', {
    p_request_id: requestId,
    p_evaluators: [...new Set(ids.data)],
  });
  if (error) return fail(error);

  const invited = (data ?? []) as unknown as Invited;
  await tell(requestId, invited);
  revalidate(workerId, requestId);
  return { ok: true, data: { added: invited.length } };
}

export async function uninviteEvaluator(assignmentId: string, requestId: string, workerId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc('hr_eval_uninvite', { p_assignment_id: assignmentId });
  if (error) return fail(error);
  revalidate(workerId, requestId);
  return { ok: true, data: undefined };
}

export async function closeEvaluation(requestId: string, workerId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc('hr_eval_close', { p_request_id: requestId });
  if (error) return fail(error);
  revalidate(workerId, requestId);
  return { ok: true, data: undefined };
}

export async function setEvaluationDeadline(requestId: string, workerId: string, deadline: string): Promise<ActionResult> {
  const parsed = DATE.safeParse(deadline);
  if (!parsed.success) return { ok: false, error: 'invalid_date' };
  const supabase = createClient();
  const { error } = await supabase.rpc('hr_eval_set_deadline', { p_request_id: requestId, p_deadline: parsed.data });
  if (error) return fail(error);
  revalidate(workerId, requestId);
  return { ok: true, data: undefined };
}

const answerSchema = z.object({
  assignment_id: z.string().uuid(),
  answers: z
    .array(z.object({
      item_id: z.string().uuid(),
      score: z.number().int().min(1).max(5).nullable(),
      body: z.string().max(5000).nullable(),
    }))
    .max(60),
  comment: z.string().max(5000).nullable(),
  submit: z.boolean(),
});

/** Save a draft, or submit — after which it can no longer be changed. */
export async function answerEvaluation(input: z.input<typeof answerSchema>): Promise<ActionResult> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_answer' };

  const supabase = createClient();
  const { error } = await supabase.rpc('hr_eval_answer', {
    p_assignment_id: parsed.data.assignment_id,
    p_answers: parsed.data.answers,
    p_comment: parsed.data.comment ?? '',
    p_submit: parsed.data.submit,
  });
  if (error) return fail(error);
  revalidate();
  revalidatePath(`/evaluations/${parsed.data.assignment_id}`);
  return { ok: true, data: undefined };
}
