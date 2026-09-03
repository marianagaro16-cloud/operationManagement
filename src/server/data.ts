import 'server-only';
import { cache } from 'react';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { generateOccurrences, isScheduleConfigured } from '@/domain/recurrence/engine';
import { FREQUENCIES } from '@/domain/recurrence/types';
import { addDays, businessToday, type BusinessDate } from '@/lib/datetime';
import type { OccurrenceWithTask, Profile, Task, Category } from '@/types/database';

/**
 * Server-side data access. Everything a page renders comes from here, so the
 * UI layer never talks to the database and never performs recurrence maths.
 */

const OCCURRENCE_SELECT = `
  id, task_id, period_key, due_date, due_date_override, status,
  completed_by, completed_at, skipped_by, skipped_at, skip_reason,
  created_at, updated_at,
  task:tasks!inner (
    id, title, description, frequency, is_skippable, is_active, category_id, translations,
    category:categories ( slug, name )
  )
`;

/** The signed-in user's profile, or null. Deduped per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  return (data as Profile) ?? null;
});

/**
 * Materialise every requirement whose due date falls in the window.
 *
 * Idempotent: the UNIQUE(task_id, period_key) constraint plus an ignoring
 * upsert means running it twice, concurrently, or after a definition edit
 * never duplicates a requirement. Runs with the service role because
 * occurrences are created by the system, not by a user.
 */
export async function ensureOccurrences(
  from: BusinessDate,
  to: BusinessDate,
): Promise<{ created: number; skippedTasks: number }> {
  const admin = createAdminClient();

  const { data: tasks, error } = await admin
    .from('tasks')
    .select('id, frequency, schedule_config, is_active')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to load tasks: ${error.message}`);

  const rows: {
    task_id: string;
    period_key: string;
    due_date: string;
  }[] = [];
  let skippedTasks = 0;

  for (const task of (tasks ?? []) as Task[]) {
    // An unconfigured task generates nothing — never a guessed date.
    if (!isScheduleConfigured(task)) {
      skippedTasks++;
      continue;
    }
    for (const plan of generateOccurrences(task, from, to)) {
      rows.push({ task_id: task.id, period_key: plan.periodKey, due_date: plan.dueDate });
    }
  }

  if (rows.length === 0) return { created: 0, skippedTasks };

  // ignoreDuplicates keeps existing rows (and their completion state) intact.
  const { data: inserted, error: upsertError } = await admin
    .from('task_occurrences')
    .upsert(rows, { onConflict: 'task_id,period_key', ignoreDuplicates: true })
    .select('id');

  if (upsertError) throw new Error(`Failed to write occurrences: ${upsertError.message}`);

  return { created: inserted?.length ?? 0, skippedTasks };
}

export interface DashboardData {
  today: BusinessDate;
  /** Due today, frequency === 'daily'. The routine checklist. */
  dailyToday: OccurrenceWithTask[];
  /** Due today, any other frequency. Drives the "extra tasks" banner. */
  extraToday: OccurrenceWithTask[];
  /** Open, due before today. */
  overdue: OccurrenceWithTask[];
  /** Open, due in the next `upcomingDays`. */
  upcoming: OccurrenceWithTask[];
}

/**
 * @param upcomingDays how many days ahead to RETURN. Pass 0 to show only
 *   today — a regular user's view is the current shift, not the week.
 *   Occurrence generation is unaffected: the horizon is always materialised
 *   so the data exists for the calendar, reports and the notifier.
 */
export async function getDashboardData(upcomingDays = 7): Promise<DashboardData> {
  const today = businessToday();

  // Always generate a full week ahead regardless of what is displayed,
  // otherwise hiding the upcoming list would stop creating the occurrences.
  const GENERATION_DAYS = 7;
  await ensureOccurrences(addDays(today, -1), addDays(today, GENERATION_DAYS + 1));

  const supabase = createClient();
  const { data, error } = await supabase
    .from('task_occurrences')
    .select(OCCURRENCE_SELECT)
    .eq('task.is_active', true)
    .lte('due_date', addDays(today, Math.max(upcomingDays, 0)))
    .order('due_date', { ascending: true });

  if (error) throw new Error(error.message);

  const all = (data ?? []) as unknown as OccurrenceWithTask[];
  const dueDate = (o: OccurrenceWithTask) => o.due_date_override ?? o.due_date;

  return {
    today,
    dailyToday: all.filter((o) => dueDate(o) === today && o.task.frequency === 'daily'),
    extraToday: all.filter((o) => dueDate(o) === today && o.task.frequency !== 'daily'),
    // Overdue keeps showing until resolved, however old it is.
    overdue: all.filter((o) => dueDate(o) < today && o.status === 'pending'),
    upcoming: all.filter((o) => dueDate(o) > today && o.status === 'pending'),
  };
}

export async function getOccurrenceComments(occurrenceId: string) {
  const supabase = createClient();
  // Named FK hint: the author relationship is task_comments.user_id -> profiles.
  const { data, error } = await supabase
    .from('task_comments')
    .select('id, body, created_at, user_id, author:profiles!task_comments_user_id_fkey ( name, email )')
    .eq('occurrence_id', occurrenceId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as {
    id: string;
    body: string;
    created_at: string;
    user_id: string;
    author: { name: string | null; email: string } | null;
  }[];
}

/* ----------------------------- admin reads ----------------------------- */

export async function getTasksForAdmin(): Promise<(Task & { category: Category | null })[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('tasks').select('*, category:categories ( * )');

  if (error) throw new Error(error.message);
  const tasks = (data ?? []) as unknown as (Task & { category: Category | null })[];

  // Ordered by frequency, in operational cadence order (daily -> semiannual)
  // rather than alphabetically, which would put "biweekly" before "daily".
  //
  // Sorted here rather than in the query because FREQUENCIES defines the
  // meaningful order; it is still server-side, and the list is ~50 rows.
  // Within a frequency: active before inactive, so deactivated definitions
  // sink to the bottom of their group instead of interleaving.
  const order = new Map(FREQUENCIES.map((f, i) => [f, i]));
  return tasks.sort((a, b) => {
    const fa = order.get(a.frequency) ?? 99;
    const fb = order.get(b.frequency) ?? 99;
    if (fa !== fb) return fa - fb;
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/** Tasks an admin must configure before they can be scheduled. */
export async function getUnconfiguredTasks(): Promise<Task[]> {
  const tasks = await getTasksForAdmin();
  return tasks.filter((t) => t.is_active && !isScheduleConfigured(t));
}

export async function getCategories(): Promise<Category[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Category[];
}

export async function getUsers(): Promise<Profile[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('status')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

/** Occurrences in an arbitrary window — powers calendar, history and stats. */
export async function getOccurrencesInRange(
  from: BusinessDate,
  to: BusinessDate,
): Promise<OccurrenceWithTask[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('task_occurrences')
    .select(OCCURRENCE_SELECT)
    .gte('due_date', from)
    .lte('due_date', to)
    .order('due_date', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OccurrenceWithTask[];
}
