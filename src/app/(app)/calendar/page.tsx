import { DateTime } from 'luxon';
import { getOccurrencesInRange, getTasksForAdmin, getViewer } from '@/server/data';
import { getInventories, getInventoryTemplates } from '@/server/inventory';
import { ensureCalendarWindow } from '@/server/scheduling';
import { BUSINESS_TZ, businessToday, toBusinessDate } from '@/lib/datetime';
import { CalendarView } from '@/components/calendar/calendar-view';
import { CalendarHeading } from '@/components/calendar/calendar-heading';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  // Regular users work the current day; the calendar is the PLANNER, so it
  // belongs to whoever plans work rather than to admins specifically.
  // Hiding the nav link alone would leave the route reachable by URL.
  const viewer = await getViewer();
  if (!viewer?.can('tasks.manage_occurrences')) redirect('/dashboard');

  const today = businessToday();

  const requested = searchParams.month
    ? DateTime.fromISO(searchParams.month, { zone: BUSINESS_TZ })
    : DateTime.fromISO(today, { zone: BUSINESS_TZ });
  const anchor = (requested.isValid ? requested : DateTime.fromISO(today, { zone: BUSINESS_TZ }))
    .startOf('month');

  const from = toBusinessDate(anchor.startOf('week'));
  const to = toBusinessDate(anchor.endOf('month').endOf('week'));

  // Materialise the DAILY checklist for the window being viewed. Everything
  // else is here because somebody put it here, so there is nothing to
  // generate for it.
  await ensureCalendarWindow(from, to);

  const [occurrences, inventories, tasks, templates] = await Promise.all([
    getOccurrencesInRange(from, to),
    // A month of a calendar cannot hold more than this, and the planner needs
    // them all rather than a first page.
    getInventories({ from, to, limit: 100 }),
    getTasksForAdmin(),
    getInventoryTemplates(),
  ]);

  const canPlanInventories = viewer.can('inventory.manage_instances');

  return (
    <>
      <CalendarHeading />
      <CalendarView
        occurrences={occurrences}
        inventories={inventories.rows.map((i) => ({
          id: i.id,
          inventory_date: i.inventory_date,
          name: i.name_snapshot,
          status: i.status,
        }))}
        tasks={tasks
          .filter((t) => t.is_active)
          .map((t) => ({ id: t.id, title: t.title, frequency: t.frequency }))}
        templates={
          canPlanInventories
            ? templates.filter((t) => t.is_active).map((t) => ({ id: t.id, name: t.name }))
            : []
        }
        month={toBusinessDate(anchor)}
        today={today}
      />
    </>
  );
}
