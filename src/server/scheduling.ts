import 'server-only';
import { ensureOccurrences } from './data';
import { addDays, businessToday, type BusinessDate } from '@/lib/datetime';
import { createClient } from '@/lib/supabase/server';

/**
 * Materialising scheduled work — one entry point, one owner.
 *
 * Generation used to happen as a SIDE EFFECT OF RENDERING: the dashboard
 * generated 7 days of tasks, the calendar generated whatever month you
 * navigated to, and the inventory dashboard generated 1 day when called from
 * the dashboard and 21 when called from its own screen. Five unrelated
 * horizons meant whether Monday's inventory existed depended on who opened
 * which page over the weekend.
 *
 * Now the cron route owns it and pages only read. The one deliberate
 * exception is the calendar — see ensureCalendarWindow below.
 *
 * WHAT IS GENERATED HAS NARROWED to the daily checklist. Every other
 * frequency, and every inventory, is placed by an admin, manager or power
 * user from the calendar. A rule that fills the next four months with work
 * nobody has decided to do is not a schedule, it is noise — so the rules for
 * those frequencies still exist, tested and correct, with no caller.
 */

export const HORIZON_DAYS = {
  /** Daily occurrences. The dashboard, notifier and reports all read inside this. */
  tasks: 60,
  /**
   * Re-materialise yesterday as well, so a definition activated late in the
   * day still produces the requirement it was meant to produce.
   */
  lookBack: 1,
} as const;

export interface ScheduleRun {
  today: BusinessDate;
  tasks: { created: number; skippedTasks: number };
}

/**
 * Materialise the daily checklist.
 *
 * Idempotent — UNIQUE(task_id, due_date) plus an ignoring upsert mean a
 * retried, overlapping or duplicated run can never create a second record,
 * overwrite one carrying entered data, or disturb one a person placed. That
 * property is what makes it safe to call from a cron, a button and a test.
 */
export async function ensureScheduled(
  taskDays: number = HORIZON_DAYS.tasks,
): Promise<ScheduleRun> {
  const today = businessToday();
  const from = addDays(today, -HORIZON_DAYS.lookBack);

  const tasks = await ensureOccurrences(from, addDays(today, taskDays));

  return { today, tasks };
}

/**
 * The calendar's on-demand window.
 *
 * The one place a page may still generate, and for a reason the cron cannot
 * cover: the calendar navigates to arbitrary months, including ones beyond
 * any fixed horizon. Browsing to next March must show the daily checklist in
 * next March rather than an empty grid.
 *
 * Daily tasks only, like everything else here. Planned work is already in the
 * table by the time anyone navigates to it — that is what planning it means.
 */
export async function ensureCalendarWindow(from: BusinessDate, to: BusinessDate) {
  return ensureOccurrences(from, to);
}

/**
 * Is the generator actually alive?
 *
 * Pages no longer generate, so a cron that has silently stopped would show up
 * as a dashboard that quietly empties out over a few days. This is the check
 * that turns that into a visible warning on the admin overview instead.
 *
 * Scoped to DAILY tasks and to rows the generator itself made. Asking the
 * broader question — "is any work scheduled ahead?" — would now fire whenever
 * a quiet week was planned, which is a normal state of the world and not a
 * fault. What we want to know is whether the one thing that still runs
 * automatically has stopped running.
 */
export async function getScheduleHealth(): Promise<{
  futureOccurrences: number;
  futureInventories: number;
  /** True when daily definitions exist but the generator produced nothing ahead. */
  stalled: boolean;
}> {
  const supabase = createClient();
  const today = businessToday();

  const [occurrences, inventories, activeDailyTasks] = await Promise.all([
    supabase
      .from('task_occurrences')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'auto')
      .gt('effective_due_date', today),
    supabase
      .from('inventory_instances')
      .select('id', { count: 'exact', head: true })
      .gt('inventory_date', today),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('frequency', 'daily'),
  ]);

  const futureOccurrences = occurrences.count ?? 0;
  const futureInventories = inventories.count ?? 0;

  return {
    futureOccurrences,
    futureInventories,
    // Only a warning when there is daily work that SHOULD have been
    // materialised. A system with no active daily tasks is not stalled.
    stalled: (activeDailyTasks.count ?? 0) > 0 && futureOccurrences === 0,
  };
}
