import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LINK_EMBEDS } from '@/domain/reminders/links';
import type { PersonalTask, Reminder, ReminderEvent, ReminderFilters, ReminderPerson } from '@/types/reminders';

/**
 * Reminders data access.
 *
 * Every read runs as the signed-in user, so RLS decides what exists: a
 * reminder the viewer does not participate in is simply not there, and there
 * is no code path here that could widen that.
 */

export const REMINDER_PAGE_SIZE = 30;

const PERSON = 'id, name, email';

export const REMINDER_SELECT = `
  id, created_by, title, notes, due_at, timezone, recurrence, recurrence_anchor,
  notify_before_minutes, snoozed_until, next_at, is_shared, status, personal_task_id,
  completed_at, cancelled_at, converted_at, created_at, updated_at,
  creator:profiles!reminders_created_by_fkey ( ${PERSON} ),
  participants:reminder_participants ( user_id, profile:profiles!reminder_participants_user_id_fkey ( ${PERSON} ) ),
  ${LINK_EMBEDS}
`;

export const PERSONAL_TASK_SELECT = `
  id, owner_id, title, notes, due_date, due_time, status, source_reminder_id,
  completed_at, cancelled_at, created_at,
  ${LINK_EMBEDS}
`;

/**
 * One page of a list view.
 *
 * Two round trips, deliberately: the filtering and search run in
 * list_reminders() against indexes and joins, and return only ids; the page
 * then reads just those rows with their embeds. Doing the search through
 * PostgREST embeds instead would mean filtering on a dozen related tables it
 * can only express as separate inner joins.
 */
export async function listReminders(
  filters: ReminderFilters,
  pageSize: number = REMINDER_PAGE_SIZE,
): Promise<{ rows: Reminder[]; total: number }> {
  const supabase = createClient();
  const { data: page, error } = await supabase.rpc('list_reminders', {
    p_view: filters.view,
    p_query: filters.q ?? null,
    p_link_type: filters.link ?? null,
    p_scope: filters.scope ?? null,
    p_creator: filters.creator ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_limit: pageSize,
    p_offset: (filters.page - 1) * pageSize,
  });
  if (error) throw new Error(error.message);

  const ids = ((page ?? []) as { id: string; total: number }[]).map((r) => r.id);
  const total = Number((page as { total: number }[] | null)?.[0]?.total ?? 0);
  if (ids.length === 0) return { rows: [], total };

  const { data, error: rowsError } = await supabase.from('reminders').select(REMINDER_SELECT).in('id', ids);
  if (rowsError) throw new Error(rowsError.message);

  // Back into the order the search decided.
  const byId = new Map(((data ?? []) as unknown as Reminder[]).map((r) => [r.id, r]));
  return { rows: ids.map((id) => byId.get(id)).filter((r): r is Reminder => Boolean(r)), total };
}

/** How many reminders a view holds, without reading any of them. */
export async function countReminders(view: ReminderFilters['view']): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('list_reminders', { p_view: view, p_limit: 1, p_offset: 0 });
  if (error) return 0;
  return Number((data as { total: number }[] | null)?.[0]?.total ?? 0);
}

export async function getReminder(
  id: string,
): Promise<{ reminder: Reminder; events: ReminderEvent[]; people: ReminderPerson[] } | null> {
  const supabase = createClient();
  const [{ data, error }, { data: events, error: eventsError }] = await Promise.all([
    supabase.from('reminders').select(REMINDER_SELECT).eq('id', id).maybeSingle(),
    supabase
      .from('reminder_events')
      .select(`id, action, detail, created_at, actor:profiles!reminder_events_actor_id_fkey ( ${PERSON} )`)
      .eq('reminder_id', id)
      .order('created_at', { ascending: true }),
  ]);
  if (error) throw new Error(error.message);
  if (eventsError) throw new Error(eventsError.message);
  if (!data) return null;

  const typedEvents = (events ?? []) as unknown as ReminderEvent[];

  // History names people who may have been removed since, so they are no
  // longer among the participants. One query for all of them.
  const mentioned = [...new Set(
    typedEvents.map((e) => (e.detail as { user_id?: string }).user_id).filter((v): v is string => Boolean(v)),
  )];
  const { data: people } = mentioned.length
    ? await supabase.from('profiles').select(PERSON).in('id', mentioned)
    : { data: [] };

  return {
    reminder: data as unknown as Reminder,
    events: typedEvents,
    people: (people ?? []) as ReminderPerson[],
  };
}

/** Due-now count for the nav badge. Cheap: one indexed count under RLS. */
export async function getReminderAttentionCount(): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('reminder_attention_count');
  // A badge is a convenience. Failing to count must never take the page down.
  if (error) return 0;
  return Number(data ?? 0);
}

/**
 * What the dashboard shows: everything overdue, the rest of today, and the
 * next few upcoming. Bounded — the dashboard is not the list screen.
 */
export async function getDashboardReminders(): Promise<{
  overdue: Reminder[];
  overdueTotal: number;
  today: Reminder[];
  upcoming: Reminder[];
}> {
  const [overdue, today, upcoming] = await Promise.all([
    listReminders({ view: 'overdue', page: 1 }, 5),
    // Today includes what already passed today, which is also overdue; ask
    // for enough to still have five left after removing those.
    listReminders({ view: 'today', page: 1 }, 15),
    listReminders({ view: 'upcoming', page: 1 }, 3),
  ]);
  const now = Date.now();
  return {
    overdue: overdue.rows.slice(0, 5),
    overdueTotal: overdue.total,
    // The today view includes what already passed today; that is overdue.
    today: today.rows.filter((r) => new Date(r.next_at).getTime() >= now).slice(0, 5),
    upcoming: upcoming.rows.slice(0, 3),
  };
}

/**
 * The viewer's personal tasks.
 *
 * Open ones in full — a personal to-do list is short by nature — and the most
 * recent closed ones, bounded.
 */
export async function getPersonalTasks(): Promise<{ open: PersonalTask[]; closed: PersonalTask[] }> {
  const supabase = createClient();
  const [openRes, closedRes] = await Promise.all([
    supabase
      .from('personal_tasks')
      .select(PERSONAL_TASK_SELECT)
      .in('status', ['open', 'in_progress'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('due_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('personal_tasks')
      .select(PERSONAL_TASK_SELECT)
      .in('status', ['completed', 'cancelled'])
      .order('updated_at', { ascending: false })
      .limit(50),
  ]);
  if (openRes.error) throw new Error(openRes.error.message);
  if (closedRes.error) throw new Error(closedRes.error.message);
  return {
    open: (openRes.data ?? []) as unknown as PersonalTask[],
    closed: (closedRes.data ?? []) as unknown as PersonalTask[],
  };
}
