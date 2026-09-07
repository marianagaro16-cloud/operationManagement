import 'server-only';
import { cache } from 'react';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { generateOccurrences, isScheduleConfigured } from '@/domain/recurrence/engine';
import { FREQUENCIES } from '@/domain/recurrence/types';
import { addDays, businessToday, type BusinessDate } from '@/lib/datetime';
import { atLeast, can, type Permission, type Role } from '@/lib/authz';
import { bucketByDay } from '@/domain/buckets';
import type { OccurrenceWithTask, Profile, Task, Category } from '@/types/database';

/**
 * The signed-in user plus their resolved capabilities, threaded into pages in
 * place of the old `isAdmin: boolean`.
 */
export interface Viewer {
  profile: Profile;
  role: Role;
  caps: ReadonlySet<Permission>;
  can: (permission: Permission) => boolean;
  atLeast: (min: Role) => boolean;
}

/**
 * Server-side data access. Everything a page renders comes from here, so the
 * UI layer never talks to the database and never performs recurrence maths.
 */

const OCCURRENCE_SELECT = `
  id, task_id, period_key, due_date, due_date_override, effective_due_date, status,
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
 * Materialise every DAILY requirement whose due date falls in the window.
 *
 * The daily checklist is the only work that still schedules itself. Weekly,
 * biweekly, monthly and semiannual tasks are placed deliberately from the
 * calendar — see `src/server/planning-actions.ts` — because a recurring rule
 * was filling months ahead with work nobody had decided to do.
 *
 * Idempotent: UNIQUE(task_id, due_date) plus an ignoring upsert means running
 * it twice, concurrently, or after a definition edit never duplicates a
 * requirement, and never disturbs one a person placed by hand. Runs with the
 * service role because these rows are created by the system, not by a user.
 */
export async function ensureOccurrences(
  from: BusinessDate,
  to: BusinessDate,
): Promise<{ created: number; skippedTasks: number }> {
  const admin = createAdminClient();

  // DAILY ONLY. Every other frequency is placed by a person from the
  // calendar, so generating it here would put back work nobody asked for —
  // and would do it again every night.
  const { data: tasks, error } = await admin
    .from('tasks')
    .select('id, frequency, schedule_config, is_active')
    .eq('is_active', true)
    .eq('frequency', 'daily');

  if (error) throw new Error(`Failed to load tasks: ${error.message}`);

  const rows: {
    task_id: string;
    period_key: string;
    due_date: string;
    source: 'auto';
  }[] = [];
  let skippedTasks = 0;

  for (const task of (tasks ?? []) as Task[]) {
    // An unconfigured task generates nothing — never a guessed date.
    if (!isScheduleConfigured(task)) {
      skippedTasks++;
      continue;
    }
    for (const plan of generateOccurrences(task, from, to)) {
      rows.push({
        task_id: task.id,
        period_key: plan.periodKey,
        due_date: plan.dueDate,
        source: 'auto',
      });
    }
  }

  if (rows.length === 0) return { created: 0, skippedTasks };

  // ignoreDuplicates keeps existing rows (and their completion state) intact.
  // Keyed on the DATE now, not the period: a task may legitimately sit on
  // several dates within one period, so the period can no longer identify it.
  const { data: inserted, error: upsertError } = await admin
    .from('task_occurrences')
    .upsert(rows, { onConflict: 'task_id,due_date', ignoreDuplicates: true })
    .select('id');

  if (upsertError) throw new Error(`Failed to write occurrences: ${upsertError.message}`);

  return { created: inserted?.length ?? 0, skippedTasks };
}

/**
 * Fill in who resolved each occurrence, and when.
 *
 * `completed_by` and `skipped_by` reference `auth.users`, so there is no
 * foreign key from an occurrence to `profiles` for PostgREST to embed — which
 * is why the dashboard has always shown a green tick and no name, while
 * `task.completedBy` sat translated into three languages and rendered nowhere.
 *
 * One extra query for the whole page, and only when something was actually
 * resolved. Mutates in place: these rows are freshly deserialised and belong
 * to the caller alone.
 */
async function attachActors(rows: OccurrenceWithTask[]): Promise<OccurrenceWithTask[]> {
  const ids = new Set<string>();
  for (const o of rows) {
    const actor = o.completed_by ?? o.skipped_by;
    if (actor) ids.add(actor);
  }
  if (ids.size === 0) return rows;

  const supabase = createClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, name, email')
    .in('id', [...ids]);

  const nameById = new Map(
    (data ?? []).map((p) => {
      const row = p as { id: string; name: string | null; email: string };
      return [row.id, row.name ?? row.email];
    }),
  );

  for (const o of rows) {
    const actor = o.completed_by ?? o.skipped_by;
    o.actor_name = actor ? nameById.get(actor) ?? null : null;
    o.resolved_at = o.completed_at ?? o.skipped_at ?? null;
  }
  return rows;
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
  /**
   * Waiting on something outside this list, whatever their due date.
   *
   * Not date-bucketed on purpose: blocked work is not late, so it is excluded
   * from `overdue`, and without its own bucket a blocked occurrence from last
   * week would simply disappear.
   */
  blocked: OccurrenceWithTask[];
}

/**
 * @param upcomingDays how many days ahead to RETURN. Pass 0 to show only
 *   today — a regular user's view is the current shift, not the week.
 *   Occurrence generation is unaffected: the horizon is always materialised
 *   so the data exists for the calendar, reports and the notifier.
 */
export async function getDashboardData(upcomingDays = 7): Promise<DashboardData> {
  const today = businessToday();

  // Reads only. Materialising occurrences is the scheduler's job — see
  // server/scheduling.ts — not a side effect of somebody opening this page.
  const supabase = createClient();
  const { data, error } = await supabase
    .from('task_occurrences')
    .select(OCCURRENCE_SELECT)
    .eq('task.is_active', true)
    // Bounded on the EFFECTIVE date, so an occurrence an admin moved into or
    // out of this window is fetched according to the date it now carries.
    .lte('effective_due_date', addDays(today, Math.max(upcomingDays, 0)))
    .order('effective_due_date', { ascending: true });

  if (error) throw new Error(error.message);

  const all = await attachActors((data ?? []) as unknown as OccurrenceWithTask[]);

  // One bucketing rule, shared with the inventory dashboard, so "overdue"
  // means the same thing on both halves of the screen.
  const buckets = bucketByDay(all, today, {
    dateOf: (o) => o.effective_due_date,
    isOpen: (o) => o.status === 'pending',
  });

  return {
    today,
    // The only task-specific split: the routine daily checklist is the
    // dashboard's spine, and anything else due today is an interruption.
    dailyToday: buckets.today.filter(
      (o) => o.task.frequency === 'daily' && o.status !== 'blocked',
    ),
    extraToday: buckets.today.filter(
      (o) => o.task.frequency !== 'daily' && o.status !== 'blocked',
    ),
    overdue: buckets.overdue,
    upcoming: buckets.upcoming,
    // Blocked work is deliberately NOT bucketed by date. `isOpen` excludes it
    // from overdue and upcoming — which is the point, it is not late — but
    // that would also make a blocked occurrence from last week vanish from
    // every list. It keeps its own section until somebody clears it.
    blocked: all.filter((o) => o.status === 'blocked'),
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
/**
 * Definitions that cannot produce what they are supposed to produce.
 *
 * DAILY only. Every other frequency is placed from the calendar, so it has no
 * schedule left to resolve and can no longer be misconfigured — flagging one
 * would be demanding a rule that nothing reads.
 */
export async function getUnconfiguredTasks(): Promise<Task[]> {
  const tasks = await getTasksForAdmin();
  return tasks.filter((t) => t.is_active && t.frequency === 'daily' && !isScheduleConfigured(t));
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

/**
 * The signed-in user together with what they may do.
 *
 * One resolution per request (React `cache`, same as `getProfile`), so a page
 * that asks five questions about permissions still issues one query. Pages pass
 * the viewer down instead of the old `isAdmin: boolean` prop, which could only
 * ever express two of the four roles.
 *
 * This is for RENDERING. Every capability is independently enforced by
 * `has_permission()` in Postgres, so a viewer who forges their way past the UI
 * gets empty lists and rejected writes.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const profile = await getProfile();
  if (!profile) return null;

  const supabase = createClient();
  const { data } = await supabase.from('role_permissions').select('permission').eq('role', profile.role);

  const caps = new Set<Permission>(
    (data ?? []).map((r) => (r as { permission: Permission }).permission),
  );

  return {
    profile,
    role: profile.role,
    caps,
    can: (permission: Permission) => can(profile.role, caps, permission),
    atLeast: (min: Role) => atLeast(profile.role, min),
  };
});

/** How many approved admins exist — the last-admin guard needs it. */
export async function countApprovedAdmins(): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('status', 'approved');
  return count ?? 0;
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
    .gte('effective_due_date', from)
    .lte('effective_due_date', to)
    .order('effective_due_date', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OccurrenceWithTask[];
}
