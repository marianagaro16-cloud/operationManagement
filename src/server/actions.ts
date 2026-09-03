'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { scheduleConfigSchema, FREQUENCIES } from '@/domain/recurrence/types';
import { addDays, businessToday } from '@/lib/datetime';
import { ensureOccurrences } from './data';

/**
 * Server actions.
 *
 * Every mutation that a non-admin can perform routes through a SECURITY
 * DEFINER RPC, so the authorization and business rules live in the database.
 * These actions are a thin, validated transport — not the security boundary.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  // Map the RPC's error codes to stable, translatable identifiers.
  if (message.includes('skip_reason_required')) return { ok: false, error: 'skip_reason_required' };
  if (message.includes('task_not_skippable')) return { ok: false, error: 'task_not_skippable' };
  if (message.includes('not_authorized')) return { ok: false, error: 'not_authorized' };
  if (message.includes('not_your_action')) return { ok: false, error: 'not_your_action' };
  if (message.includes('occurrence_not_found')) return { ok: false, error: 'occurrence_not_found' };
  return { ok: false, error: message };
}

/* --------------------------- occurrence state -------------------------- */

export async function completeOccurrence(occurrenceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc('complete_occurrence', { p_occurrence_id: occurrenceId });
  if (error) return fail(error);
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

export async function skipOccurrence(
  occurrenceId: string,
  reason: string,
): Promise<ActionResult> {
  // Checked here for a fast, translated message; the database checks it again.
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: 'skip_reason_required' };
  }
  const supabase = createClient();
  const { error } = await supabase.rpc('skip_occurrence', {
    p_occurrence_id: occurrenceId,
    p_reason: reason.trim(),
  });
  if (error) return fail(error);
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

export async function reopenOccurrence(occurrenceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc('reopen_occurrence', { p_occurrence_id: occurrenceId });
  if (error) return fail(error);
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

/* ------------------------------- comments ------------------------------ */

export async function addComment(
  occurrenceId: string,
  taskId: string,
  body: string,
): Promise<ActionResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'comment_required' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const { error } = await supabase.from('task_comments').insert({
    occurrence_id: occurrenceId,
    task_id: taskId,
    user_id: user.id,
    body: trimmed,
  });
  if (error) return fail(error);
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

/* ---------------------------- admin: tasks ----------------------------- */

/** Per-locale overrides. Spanish is the source and lives in title/description. */
const translationSchema = z
  .object({
    title: z.string().trim().nullable().optional(),
    description: z.string().trim().nullable().optional(),
  })
  .optional();

const taskInputSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
  // Only the locales the app supports; the database CHECK enforces this too.
  translations: z.object({ de: translationSchema, en: translationSchema }).default({}),
  category_id: z.string().uuid().nullable().optional(),
  frequency: z.enum(FREQUENCIES),
  // Null is a legitimate value: it flags the task as needing configuration
  // instead of letting an invented schedule reach production.
  schedule_config: scheduleConfigSchema.nullable(),
  is_skippable: z.boolean(),
  is_active: z.boolean(),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

export async function saveTask(
  input: TaskInput,
  taskId?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const supabase = createClient();

  const query = taskId
    ? supabase.from('tasks').update(parsed.data).eq('id', taskId).select('id').single()
    : supabase.from('tasks').insert(parsed.data).select('id').single();

  const { data, error } = await query;
  if (error) return fail(error);

  revalidatePath('/admin/tasks');
  revalidatePath('/dashboard');
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/** Soft delete only. History must survive. */
export async function setTaskActive(taskId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('tasks').update({ is_active: isActive }).eq('id', taskId);
  if (error) return fail(error);
  revalidatePath('/admin/tasks');
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

/** Move a single occurrence without altering the rule that produced it. */
export async function overrideOccurrenceDate(
  occurrenceId: string,
  date: string | null,
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from('task_occurrences')
    .update({ due_date_override: date })
    .eq('id', occurrenceId);
  if (error) return fail(error);
  revalidatePath('/admin/calendar');
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

/* ---------------------------- admin: users ----------------------------- */

const userStatusSchema = z.enum(['pending', 'approved', 'rejected', 'deactivated']);

export async function setUserStatus(
  userId: string,
  status: z.infer<typeof userStatusSchema>,
): Promise<ActionResult> {
  const parsed = userStatusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: 'invalid_status' };

  const supabase = createClient();
  const { error } = await supabase.from('profiles').update({ status: parsed.data }).eq('id', userId);
  if (error) return fail(error);
  revalidatePath('/admin/users');
  return { ok: true, data: undefined };
}

export async function setUserRole(userId: string, role: 'admin' | 'user'): Promise<ActionResult> {
  const supabase = createClient();

  // Guard against removing the last admin and locking everyone out.
  if (role === 'user') {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('status', 'approved');
    if ((count ?? 0) <= 1) return { ok: false, error: 'last_admin' };
  }

  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
  if (error) return fail(error);
  revalidatePath('/admin/users');
  return { ok: true, data: undefined };
}

/* -------------------------- occurrence horizon ------------------------- */

/** Manual generation from the admin settings screen. */
export async function generateHorizon(days = 60): Promise<ActionResult<{ created: number }>> {
  const supabase = createClient();
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (!isAdmin) return { ok: false, error: 'not_authorized' };

  const today = businessToday();
  try {
    const { created } = await ensureOccurrences(today, addDays(today, days));
    revalidatePath('/dashboard');
    revalidatePath('/admin');
    return { ok: true, data: { created } };
  } catch (e) {
    return fail(e);
  }
}
