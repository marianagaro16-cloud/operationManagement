'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { periodKeyForDate } from '@/domain/recurrence/periods';
import { resolveScheduleConfig } from '@/domain/recurrence/engine';
import type { Frequency } from '@/domain/recurrence/types';
import type { ActionResult } from './actions';

/**
 * Placing scheduled work by hand.
 *
 * The daily checklist still materialises itself. Everything else — every
 * weekly, biweekly, monthly and semiannual task, and every inventory — is put
 * on a date by an admin, manager or power user from the calendar.
 *
 * A thin, validated transport, NOT the security boundary: the
 * `tasks.manage_occurrences` and `inventory.manage_instances` policies already
 * govern these tables, so these actions run on the authenticated client and
 * the database rejects anyone who should not be here. What they add is
 * batching, a translatable error, and the period label.
 */

const BUSINESS_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });

const planSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, { message: 'nothing_selected' }),
  dates: z.array(BUSINESS_DATE).min(1, { message: 'no_dates' }),
});

/**
 * A batch is capped because the planner offers "every day this month" against
 * a multi-select: 40 items × 31 days is 1,240 rows from one click, which is
 * far more likely to be a misunderstanding than an intention.
 */
const MAX_ROWS = 400;

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('violates row-level security')) {
    return { ok: false, error: 'not_authorized' };
  }
  if (message.includes('task_occurrences_task_date_key')) {
    // Every row in the batch collided; nothing was added.
    return { ok: false, error: 'already_planned' };
  }
  if (message.includes('inventory_instances_template_date_key')) {
    return { ok: false, error: 'already_planned' };
  }
  return { ok: false, error: message };
}

/* -------------------------------- tasks -------------------------------- */

/**
 * Put tasks on dates. One occurrence per (task, date) pair.
 *
 * Duplicates are ignored rather than failing the batch: planning a month over
 * a week that was already planned should add the missing days and leave the
 * rest alone, not refuse the whole operation.
 */
export async function planTasks(
  taskIds: string[],
  dates: string[],
): Promise<ActionResult<{ created: number }>> {
  const parsed = planSchema.safeParse({ ids: taskIds, dates });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_plan' };
  }
  if (parsed.data.ids.length * parsed.data.dates.length > MAX_ROWS) {
    return { ok: false, error: 'plan_too_large' };
  }

  const supabase = createClient();

  // The frequency and schedule are needed only to LABEL the row: period_key
  // is a reporting label now, not identity, so it never decides what is
  // written — it just keeps History and the report groupings readable.
  const { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select('id, frequency, schedule_config')
    .in('id', parsed.data.ids);
  if (taskError) return fail(taskError);
  if (!tasks || tasks.length === 0) return { ok: false, error: 'task_not_found' };

  const rows = [];
  for (const raw of tasks as { id: string; frequency: Frequency; schedule_config: unknown }[]) {
    const resolved = resolveScheduleConfig(raw.frequency, raw.schedule_config);
    const config = resolved.ok ? resolved.config : null;

    for (const date of parsed.data.dates) {
      rows.push({
        task_id: raw.id,
        due_date: date,
        // Falls back to the date itself when no period can be derived — a
        // biweekly task with no anchor has no cycle to belong to, and a label
        // is not worth inventing one for.
        period_key: periodKeyForDate(raw.frequency, date, config) ?? date,
        source: 'manual' as const,
      });
    }
  }

  const { data: inserted, error } = await supabase
    .from('task_occurrences')
    .upsert(rows, { onConflict: 'task_id,due_date', ignoreDuplicates: true })
    .select('id');

  if (error) return fail(error);

  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  return { ok: true, data: { created: inserted?.length ?? 0 } };
}

/**
 * Take a planned task back off the calendar.
 *
 * Only while it is still pending. A completed or skipped occurrence is the
 * record that the work happened, or was consciously not done, and deleting
 * that would erase history to tidy a calendar.
 */
export async function unplanTask(occurrenceId: string): Promise<ActionResult> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('task_occurrences')
    .delete()
    .eq('id', occurrenceId)
    .eq('status', 'pending')
    .select('id');

  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, error: 'not_removable' };

  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

/* ----------------------------- inventories ----------------------------- */

/**
 * Put inventories on dates.
 *
 * The snapshot and materialise triggers do the rest: name, kind and digital
 * flag are frozen from the template, the active items are copied on, and the
 * template's usual counters are assigned. Only the identity is written here.
 */
export async function planInventories(
  templateIds: string[],
  dates: string[],
): Promise<ActionResult<{ created: number }>> {
  const parsed = planSchema.safeParse({ ids: templateIds, dates });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_plan' };
  }
  if (parsed.data.ids.length * parsed.data.dates.length > MAX_ROWS) {
    return { ok: false, error: 'plan_too_large' };
  }

  const supabase = createClient();

  const rows = parsed.data.ids.flatMap((templateId) =>
    parsed.data.dates.map((date) => ({
      template_id: templateId,
      inventory_date: date,
      // A reporting label here too. The date is the identity.
      period_key: date,
      source: 'manual' as const,
      // NOT NULL columns the BEFORE INSERT trigger overwrites from the
      // template, which is the only authority on them. iso_week and iso_year
      // are deliberately absent: they are generated.
      name_snapshot: '',
      kind: 'expiry',
      digital_enabled: false,
    })),
  );

  const { data: inserted, error } = await supabase
    .from('inventory_instances')
    .upsert(rows, { onConflict: 'template_id,inventory_date', ignoreDuplicates: true })
    .select('id');

  if (error) return fail(error);

  revalidatePath('/calendar');
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
  return { ok: true, data: { created: inserted?.length ?? 0 } };
}

/**
 * Take a planned inventory back off the calendar.
 *
 * Refused the moment anything has been counted into it. The delete would
 * cascade to the items and entries, so an unguarded one destroys entered
 * data — and there is already a future inventory in this database carrying
 * counts, so this is not a hypothetical.
 */
export async function unplanInventory(instanceId: string): Promise<ActionResult> {
  const supabase = createClient();

  const [entries, comments, instance] = await Promise.all([
    supabase.from('inventory_entries').select('id').eq('instance_id', instanceId).limit(1),
    supabase.from('inventory_comments').select('id').eq('instance_id', instanceId).limit(1),
    supabase.from('inventory_instances').select('completed_at').eq('id', instanceId).maybeSingle(),
  ]);

  if (!instance.data) return { ok: false, error: 'inventory_not_found' };
  if (
    (entries.data?.length ?? 0) > 0 ||
    (comments.data?.length ?? 0) > 0 ||
    (instance.data as { completed_at: string | null }).completed_at !== null
  ) {
    return { ok: false, error: 'inventory_in_use' };
  }

  const { data, error } = await supabase
    .from('inventory_instances')
    .delete()
    .eq('id', instanceId)
    .select('id');

  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, error: 'not_removable' };

  revalidatePath('/calendar');
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}
