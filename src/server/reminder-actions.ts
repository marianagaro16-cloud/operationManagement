'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { LINK_COLUMN, LINK_TYPES, type LinkType } from '@/domain/reminders/links';
import {
  NOTIFY_BEFORE,
  RECURRENCES,
  advanceAfterCompletion,
  isValidTimezone,
  localToUtc,
  snoozeUntil,
  SNOOZE_PRESETS,
} from '@/domain/reminders/schedule';
import { getViewer } from './data';
import type { ActionResult } from './actions';
import type { ReminderPerson } from '@/types/reminders';
import { canUseReminders } from '@/lib/authz';

/**
 * Reminder and Personal Task mutations.
 *
 * Reminders are written only through the reminder_* functions, which hold
 * the rules (who may edit, who may be added, what may be converted) and write
 * the history in the same transaction. These actions validate the input for
 * a fast, translated message and compute what needs a clock or a calendar —
 * the database is still the boundary.
 */

const CODES = [
  'not_authorized',
  'title_required',
  'due_required',
  'invalid_recurrence',
  'invalid_link',
  'reminder_not_found',
  'reminder_closed',
  'participant_not_eligible',
  'snooze_in_past',
  'snooze_too_far',
  'invalid_next_occurrence',
  'shared_cannot_convert',
  'invalid_date',
  'invalid_timezone',
] as const;

export type ReminderErrorCode = (typeof CODES)[number] | 'unknown';

function fail(error: unknown): { ok: false; error: ReminderErrorCode } {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error);
  const code = CODES.find((c) => message.includes(c));
  if (code) return { ok: false, error: code };
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return { ok: false, error: 'not_authorized' };
  }
  // Never swallowed: the raw message goes to the server log, a stable code to
  // the screen, and the form keeps what was typed.
  console.error('[reminders]', message);
  return { ok: false, error: 'unknown' };
}

async function requireAccess(): Promise<boolean> {
  const viewer = await getViewer();
  return canUseReminders(viewer);
}

function revalidateReminders(id?: string) {
  revalidatePath('/reminders');
  revalidatePath('/reminders/tasks');
  revalidatePath('/dashboard');
  if (id) revalidatePath(`/reminders/${id}`);
}

/* ------------------------------ reminders ------------------------------ */

const saveSchema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().min(1),
  recurrence: z.enum(RECURRENCES),
  notifyBefore: z.number().int().nullable().refine(
    (v) => v === null || (NOTIFY_BEFORE as readonly number[]).includes(v),
  ),
  link: z.object({ type: z.enum(LINK_TYPES), id: z.string().uuid() }).nullable(),
  participantIds: z.array(z.string().uuid()).max(50),
});

export type SaveReminderInput = z.infer<typeof saveSchema>;

export async function saveReminder(input: SaveReminderInput): Promise<ActionResult<{ id: string }>> {
  if (!(await requireAccess())) return { ok: false, error: 'not_authorized' };

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { ok: false, error: field === 'title' ? 'title_required' : field === 'recurrence' ? 'invalid_recurrence' : 'invalid_date' };
  }
  const v = parsed.data;
  if (!isValidTimezone(v.timezone)) return { ok: false, error: 'invalid_timezone' };

  const dueAt = localToUtc(v.date, v.time, v.timezone);
  if (!dueAt) return { ok: false, error: 'invalid_date' };

  const supabase = createClient();
  const { data, error } = await supabase.rpc('reminder_save', {
    p_id: v.id,
    p_title: v.title,
    p_notes: v.notes,
    p_due_at: dueAt,
    p_timezone: v.timezone,
    p_recurrence: v.recurrence,
    p_notify_before: v.notifyBefore,
    p_link_type: v.link?.type ?? null,
    p_link_id: v.link?.id ?? null,
    p_participants: v.participantIds,
  });
  if (error) return fail(error);

  const id = data as string;
  revalidateReminders(id);
  return { ok: true, data: { id } };
}

export async function snoozeReminder(
  id: string,
  choice: { preset: (typeof SNOOZE_PRESETS)[number] } | { date: string; time: string; timezone: string },
): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: 'not_authorized' };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'reminder_not_found' };

  let until: string | null;
  if ('preset' in choice) {
    if (!(SNOOZE_PRESETS as readonly string[]).includes(choice.preset)) return { ok: false, error: 'invalid_date' };
    until = snoozeUntil(choice.preset, new Date().toISOString());
  } else {
    if (!isValidTimezone(choice.timezone)) return { ok: false, error: 'invalid_timezone' };
    until = localToUtc(choice.date, choice.time, choice.timezone);
  }
  if (!until) return { ok: false, error: 'invalid_date' };

  const supabase = createClient();
  const { error } = await supabase.rpc('reminder_snooze', { p_id: id, p_until: until });
  if (error) return fail(error);
  revalidateReminders(id);
  return { ok: true, data: undefined };
}

export async function completeReminder(id: string): Promise<ActionResult<{ nextDueAt: string | null }>> {
  if (!(await requireAccess())) return { ok: false, error: 'not_authorized' };

  const supabase = createClient();
  // Read under RLS first: the next occurrence is computed from the stored rule,
  // never from anything the browser sent.
  const { data: row, error: readError } = await supabase
    .from('reminders')
    .select('id, recurrence, recurrence_anchor, due_at, timezone, status')
    .eq('id', id)
    .maybeSingle();
  if (readError) return fail(readError);
  if (!row) return { ok: false, error: 'reminder_not_found' };

  const nextDueAt =
    row.recurrence !== 'none' && row.recurrence_anchor
      ? advanceAfterCompletion(row.recurrence, row.recurrence_anchor, row.due_at, new Date().toISOString(), row.timezone)
      : null;

  const { error } = await supabase.rpc('reminder_complete', { p_id: id, p_next_due_at: nextDueAt });
  if (error) return fail(error);
  revalidateReminders(id);
  return { ok: true, data: { nextDueAt } };
}

export async function cancelReminder(id: string): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { error } = await supabase.rpc('reminder_cancel', { p_id: id });
  if (error) return fail(error);
  revalidateReminders(id);
  return { ok: true, data: undefined };
}

/** Reminder -> Personal Task. The database function is the only writer. */
export async function convertReminder(id: string): Promise<ActionResult<{ personalTaskId: string }>> {
  if (!(await requireAccess())) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { data, error } = await supabase.rpc('reminder_convert', { p_id: id });
  if (error) return fail(error);
  revalidateReminders(id);
  return { ok: true, data: { personalTaskId: data as string } };
}

/**
 * Who a reminder can be shared with. Loaded when the share section is opened,
 * not with every page — most reminders are personal.
 */
export async function loadParticipantCandidates(): Promise<ActionResult<ReminderPerson[]>> {
  if (!(await requireAccess())) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { data, error } = await supabase.rpc('reminder_participant_candidates');
  if (error) return fail(error);
  return { ok: true, data: (data ?? []) as ReminderPerson[] };
}

/* ---------------------------- personal tasks ---------------------------- */

const taskSchema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  link: z.object({ type: z.enum(LINK_TYPES), id: z.string().uuid() }).nullable(),
});

export type SavePersonalTaskInput = z.infer<typeof taskSchema>;

function linkColumns(link: { type: LinkType; id: string } | null): Record<string, string | null> {
  return Object.fromEntries(
    LINK_TYPES.map((type) => [LINK_COLUMN[type], link && link.type === type ? link.id : null]),
  );
}

export async function savePersonalTask(input: SavePersonalTaskInput): Promise<ActionResult<{ id: string }>> {
  const viewer = await getViewer();
  if (!viewer || !canUseReminders(viewer)) return { ok: false, error: 'not_authorized' };

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.path[0] === 'title' ? 'title_required' : 'invalid_date' };
  }
  const v = parsed.data;
  if (v.time && !v.date) return { ok: false, error: 'invalid_date' };

  const fields = {
    title: v.title,
    notes: v.notes?.trim() || null,
    due_date: v.date,
    due_time: v.time,
    ...linkColumns(v.link),
  };

  const supabase = createClient();
  // owner_id is always the viewer; RLS refuses anything else regardless.
  const res = v.id
    ? await supabase.from('personal_tasks').update(fields).eq('id', v.id).select('id').maybeSingle()
    : await supabase.from('personal_tasks').insert({ ...fields, owner_id: viewer.profile.id }).select('id').single();

  if (res.error) return fail(res.error);
  if (!res.data) return { ok: false, error: 'not_authorized' };
  revalidateReminders();
  return { ok: true, data: { id: (res.data as { id: string }).id } };
}

export async function setPersonalTaskStatus(
  id: string,
  status: 'open' | 'completed' | 'cancelled',
): Promise<ActionResult> {
  if (!(await requireAccess())) return { ok: false, error: 'not_authorized' };
  if (!['open', 'completed', 'cancelled'].includes(status)) return { ok: false, error: 'unknown' };

  const now = new Date().toISOString();
  const supabase = createClient();
  const { data, error } = await supabase
    .from('personal_tasks')
    .update({
      status,
      completed_at: status === 'completed' ? now : null,
      cancelled_at: status === 'cancelled' ? now : null,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return { ok: false, error: 'not_authorized' };
  revalidateReminders();
  return { ok: true, data: undefined };
}
