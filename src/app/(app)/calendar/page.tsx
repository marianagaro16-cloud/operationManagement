import { DateTime } from 'luxon';
import { getOccurrencesInRange, getTasksForAdmin, getUsers, getViewer } from '@/server/data';
import { displayName } from '@/lib/utils';
import { getInventories, getInventoryTemplates } from '@/server/inventory';
import { ensureCalendarWindow } from '@/server/scheduling';
import { getPausedActivityTeams } from '@/server/paused-teams';
import { TEAMS, type Team } from '@/lib/authz';
import { BUSINESS_TZ, businessToday, toBusinessDate } from '@/lib/datetime';
import { CalendarView } from '@/components/calendar/calendar-view';
import { CalendarHeading } from '@/components/calendar/calendar-heading';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { month?: string; team?: string };
}) {
  // Regular users work the current day; the calendar is the PLANNER, so it
  // belongs to whoever plans work rather than to admins specifically.
  // Hiding the nav link alone would leave the route reachable by URL.
  const viewer = await getViewer();
  if (!viewer?.can('tasks.manage_occurrences')) redirect('/dashboard');

  const today = businessToday();
  // An area's own activities (from its menu entry); none given shows every team.
  const team = (TEAMS as readonly string[]).includes(searchParams.team ?? '') ? (searchParams.team as Team) : undefined;

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

  const [occurrences, inventories, tasks, templates, users, pausedTeams] = await Promise.all([
    getOccurrencesInRange(from, to, team),
    // A month of a calendar cannot hold more than this, and the planner needs
    // them all rather than a first page. Inventories are the warehouse's: not on
    // Logística's or Producción's calendar.
    team && team !== 'operations' ? Promise.resolve({ rows: [] as Awaited<ReturnType<typeof getInventories>>['rows'] }) : getInventories({ from, to, limit: 100 }),
    getTasksForAdmin(),
    getInventoryTemplates(),
    // For giving a one-off activity to one person.
    getUsers(),
    // A paused team's activities cannot go on the calendar, so they are not offered.
    getPausedActivityTeams(),
  ]);
  const activityTeams = TEAMS.filter((tm) => !pausedTeams.includes(tm) && (!team || tm === team));

  const canPlanInventories = viewer.can('inventory.manage_instances');

  return (
    <>
      <CalendarHeading team={team} paused={!!team && pausedTeams.includes(team)} />
      <CalendarView
        occurrences={occurrences}
        inventories={inventories.rows.map((i) => ({
          id: i.id,
          inventory_date: i.inventory_date,
          name: i.name_snapshot,
          translations: i.template?.translations,
          status: i.status,
        }))}
        tasks={tasks
          .filter((t) => t.is_active && activityTeams.includes(t.team))
          // An area's calendar plans that area's activities.
          .map((t) => ({ id: t.id, title: t.title, frequency: t.frequency }))}
        templates={
          canPlanInventories && (!team || team === 'operations')
            ? templates.filter((t) => t.is_active).map((t) => ({ id: t.id, name: t.name }))
            : []
        }
        people={users
          .filter((u) => u.status === 'approved')
          .map((u) => ({ id: u.id, name: displayName(u), team: u.team }))}
        viewerTeam={team ?? viewer.profile.team}
        team={team}
        activityTeams={activityTeams}
        // A one-off may be planned even for a paused team; recurring work may not.
        oneOffTeams={TEAMS.filter((tm) => !team || tm === team)}
        month={toBusinessDate(anchor)}
        today={today}
      />
    </>
  );
}
