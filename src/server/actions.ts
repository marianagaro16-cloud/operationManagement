'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { scheduleConfigSchema, FREQUENCIES } from '@/domain/recurrence/types';
import { ROLES, wouldOrphanAdmins, type Role } from '@/lib/authz';
import { countApprovedAdmins } from './data';
import { ensureScheduled } from './scheduling';

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
  if (message.includes('block_reason_required')) return { ok: false, error: 'block_reason_required' };
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

/**
 * "I cannot do this, and it is not my decision."
 *
 * Distinct from a skip, which records a decision NOT to do the work. A block
 * says the work is still owed and is waiting on something else, so it leaves
 * the day's count without being counted as late.
 */
export async function blockOccurrence(
  occurrenceId: string,
  reason: string,
): Promise<ActionResult> {
  // Checked here for a fast, translated message; the database checks it again.
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: 'block_reason_required' };
  }
  const supabase = createClient();
  const { error } = await supabase.rpc('block_occurrence', {
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

const userRoleSchema = z.enum(ROLES);

export async function setUserRole(userId: string, role: Role): Promise<ActionResult> {
  const parsed = userRoleSchema.safeParse(role);
  if (!parsed.success) return { ok: false, error: 'invalid_role' };

  const supabase = createClient();

  // Guard against removing the last admin and locking everyone out.
  //
  // This used to trigger on `role === 'user'`, which was correct while those
  // were the only two values. With four roles, demoting the final admin to
  // `manager` would have walked straight past it — so the question is now
  // "is this user leaving the admin role at all", not "where are they going".
  const { data: current } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (current) {
    const currentRole = (current as { role: Role }).role;
    if (wouldOrphanAdmins({
      currentRole,
      nextRole: parsed.data,
      approvedAdminCount: await countApprovedAdmins(),
    })) {
      return { ok: false, error: 'last_admin' };
    }
  }

  const { error } = await supabase.from('profiles').update({ role: parsed.data }).eq('id', userId);
  if (error) return fail(error);
  revalidatePath('/admin/users');
  revalidatePath('/admin/permissions');
  return { ok: true, data: undefined };
}

/* -------------------------- occurrence horizon ------------------------- */

/**
 * Manual generation from the admin settings screen.
 *
 * Covers BOTH task occurrences and inventories. It used to cover tasks only,
 * so an admin who noticed a gap in the inventory schedule had no way to close
 * it and had to wait for the next cron run.
 */
export async function generateHorizon(
  days = 60,
): Promise<ActionResult<{ created: number }>> {
  // Self-gated because what follows uses the SERVICE-ROLE client, which
  // bypasses RLS entirely — so this check is the only one that runs.
  const supabase = createClient();
  const { data: allowed } = await supabase.rpc('has_permission', { p_key: 'tasks.manage_occurrences' });
  if (!allowed) return { ok: false, error: 'not_authorized' };

  try {
    // Daily tasks only. Everything else is placed from the calendar, so there
    // is no horizon to fill for it.
    const run = await ensureScheduled(days);
    revalidatePath('/dashboard');
    revalidatePath('/admin');
    return { ok: true, data: { created: run.tasks.created } };
  } catch (e) {
    return fail(e);
  }
}
