import type { ReactNode } from 'react';
import { getDashboardData, getViewer } from '@/server/data';
import { getOrderDashboardSummary } from '@/server/orders';
import { getInventoryDashboard } from '@/server/inventory';
import { businessToday } from '@/lib/datetime';
import { DashboardView } from '@/components/tasks/dashboard-view';
import { OrderWidgets } from '@/components/orders/order-widgets';
import { InventoryWidget } from '@/components/inventory/inventory-widget';
import { PushPrompt } from '@/components/shell/push-prompt';
import { getDashboardReminders, getPersonalTasks } from '@/server/reminders';
import { ReminderWidgets } from '@/components/reminders/reminder-widgets';
import { canUseReminders, isAdminRole, isSales } from '@/lib/authz';
import { getMyPendingEvaluations } from '@/server/hr-evaluations';
import { PendingEvaluations } from '@/components/hr/pending-evaluations';
import { getUpcomingCelebrations } from '@/server/hr-celebrations';
import { CelebrationsCard } from '@/components/hr/celebrations-card';
import { countMyLateActivities, getActivityKinds, getDayRoutePoints, getPlanDay, getQuietCustomers } from '@/server/sales';
import { TodayPlanCard } from '@/components/sales/today-plan-card';
import { QuietCustomersCard } from '@/components/sales/quiet-customers-card';
import { getBusinessFigures } from '@/server/dashboard';
import { BusinessFigures, Greeting, NowCard, ProgressFigures } from '@/components/dashboard/dashboard-top';
import { buildNowItems } from '@/domain/dashboard/now';
import { countPendingAbsences } from '@/server/absences';
import { countCoverageGaps, getCoverageBetween, getCoveredWork, getNeedsCoverIds, getWorkingHours } from '@/server/coverage';
import { CoveringNowCard } from '@/components/absences/covering-now-card';
import { getAgenda } from '@/server/agenda';
import { TodayCard } from '@/components/agenda/today-card';
import { countUnansweredInvites } from '@/server/meetings';
import { countFollowUpsDue } from '@/server/collections';
import { CoverageTodayCard } from '@/components/absences/coverage-today-card';
import { TeamTodayCard, type TeamToday } from '@/components/tasks/team-today-card';
import type { Team } from '@/lib/authz';
import { NotesCard } from '@/components/notes/notes-view';
import { getNotes } from '@/server/notes';
import { compareUrgency, deliveryUrgency } from '@/domain/orders/urgency';
import { personalTaskPhase } from '@/domain/reminders/schedule';

// Always render fresh: task and order state change constantly during a shift.
export const dynamic = 'force-dynamic';

/** A tile of the card grid; takes no room when its card renders nothing. */
function Tile({ children }: { children: ReactNode }) {
  return <div className="mb-4 break-inside-avoid empty:hidden [&>*]:mb-0">{children}</div>;
}

/**
 * The dashboard, top to bottom: who and when; the figures — how the business
 * is going for owners and Admin, today's progress for everyone else; then
 * "Now", only what is late or due, most urgent first; the cards, in a grid on
 * a computer; and the day's activities, full width.
 *
 * Fixed per role: every card still appears only for whom it applies, and
 * only when there is something in it.
 */
export default async function DashboardPage() {
  const today = businessToday();
  const viewer = await getViewer();
  // Whoever plans work gets the forward view; everyone else gets today.
  // A regular user's dashboard is the current day. Showing a week ahead
  // invites working on tomorrow's list, and buries what is due now.
  const plans = viewer?.can('tasks.manage_occurrences') ?? false;
  const canManageOrders = viewer?.can('orders.manage') ?? false;
  // Every approved account has reminders and personal tasks, whatever its role.
  const usesReminders = canUseReminders(viewer);
  const owner = isAdminRole(viewer?.role);
  const sales = !!viewer && isSales(viewer.role, viewer.profile.team);
  const inSalesTeam = viewer?.profile.team === 'sales';

  const [data, orders, inventory, reminders, personalTasks, evaluations, celebrations, quiet, todayPlan, planLate, visitPoints, kinds, business, absencesToApprove, coverageToday, needsCover, workingHours, coverageGaps, meetingInvites, agendaToday, collectionFollowUps, quickNotes] = await Promise.all([
    // Today and what is late — no week ahead: one's own are listed, the team's counted.
    getDashboardData(0),
    getOrderDashboardSummary(today),
    // A short horizon: the dashboard only surfaces what is due now or late.
    // The forward view lives on the inventory screen.
    getInventoryDashboard(1),
    usesReminders ? getDashboardReminders() : null,
    usesReminders ? getPersonalTasks() : null,
    // Anyone may be asked to evaluate someone.
    viewer ? getMyPendingEvaluations() : [],
    // Birthdays and anniversaries of the people whose files the viewer may open.
    viewer?.can('hr.manage') ? getUpcomingCelebrations() : [],
    // Customers going quiet: the Ventas team's card, not Admin's or the owners'.
    inSalesTeam ? getQuietCustomers() : [],
    // The viewer's own sales plan today, what is still planned from before, and the route.
    sales && viewer ? getPlanDay(viewer.profile.id, today) : [],
    sales ? countMyLateActivities(today) : 0,
    sales && viewer ? getDayRoutePoints(viewer.profile.id, today) : null,
    sales ? getActivityKinds(true) : [],
    // How the business is going: owners and Admin.
    owner ? getBusinessFigures(today) : null,
    // Requests waiting for the viewer's decision: RLS returns none to anyone who is not an approver.
    viewer ? countPendingAbsences() : 0,
    // Who is away today and who covers them: everyone sees it.
    viewer ? getCoverageBetween(today, today) : { away: [], coverage: [] },
    viewer ? getNeedsCoverIds() : [],
    viewer ? getWorkingHours() : null,
    // Upcoming absences with time nobody covers: approvers count all, anyone else their own.
    viewer ? countCoverageGaps(today, viewer.profile.id) : 0,
    // The viewer's meetings today, and invitations not answered yet.
    viewer ? countUnansweredInvites(viewer.profile.id, today) : 0,
    // "Hoy": the viewer's day from the agenda.
    viewer ? getAgenda(viewer.profile.id, today, today, true, today) : [],
    // Collection cases due for follow-up: RLS returns none outside the team.
    viewer ? countFollowUpsDue(viewer.profile.id, today) : 0,
    // The latest quick notes, pinned first.
    viewer ? getNotes({ limit: 4 }) : [],
  ]);

  // ---- whoever plans: their own activities, and the team in one line per area ----
  // A planner's list used to hold everyone's days, today's and the week's —
  // confusing. Their own are listed; the team's are counted per area, the
  // detail one tap away in the work plan.
  const meId = viewer?.profile.id;
  const mine = (list: typeof data.overdue) => list.filter((o) => o.assignee_id === meId);
  const myData = plans
    ? { ...data, dailyToday: mine(data.dailyToday), extraToday: mine(data.extraToday), overdue: mine(data.overdue), upcoming: [], blocked: mine(data.blocked) }
    : data;
  const teamToday: TeamToday[] = plans
    ? [...new Set([...data.dailyToday, ...data.extraToday, ...data.overdue, ...data.blocked].map((o) => o.task.team))]
        .filter((tm): tm is Team => !!tm)
        .map((tm) => {
          const day = [...data.dailyToday, ...data.extraToday].filter((o) => o.task.team === tm);
          return {
            team: tm,
            total: day.length,
            done: day.filter((o) => o.status !== 'pending').length,
            late: data.overdue.filter((o) => o.task.team === tm).length,
            blocked: data.blocked.filter((o) => o.task.team === tm).length,
          };
        })
        .sort((a, b) => b.late - a.late || b.total - a.total)
    : [];

  // ---- what the figures and "Now" count ----
  const todayAll = [...data.dailyToday, ...data.extraToday];
  const activities = { done: todayAll.filter((o) => o.status !== 'pending').length, total: todayAll.length };
  const countsToday = [...inventory.overdue, ...inventory.dueToday];
  const now = new Date();
  const nowIso = now.toISOString();
  const urgentOrders = [...orders.toPrepare, ...orders.carriedOver]
    .map((o) => ({ o, u: deliveryUrgency(o.delivery_date, o.delivery_time, Boolean(o.ready_at), now) }))
    .filter((x) => x.u.isAlert)
    .sort((a, b) => compareUrgency(a.u, b.u))
    .map((x) => ({ name: x.o.customer.name, late: x.u.level === 'overdue' || x.u.level === 'critical' }));

  const nowItems = buildNowItems({
    // One's own late days; the team's are counted on the team card.
    overdueActivities: myData.overdue.length,
    blockedActivities: plans ? myData.blocked.length : 0,
    urgentOrders,
    overdueCounts: inventory.overdue.length,
    // Today's counts and sales activities are listed in "Hoy"; "Ahora" keeps what is late or urgent.
    countsToday: 0,
    overdueReminders: reminders?.overdueTotal ?? 0,
    overduePersonalTasks: (personalTasks?.open ?? []).filter(
      (task) => personalTaskPhase(task.status, task.due_date, task.due_time, nowIso) === 'overdue',
    ).length,
    planLate,
    planToday: 0,
    evaluationsDue: evaluations.filter((e) => e.request.deadline === today).length,
    absencesToApprove,
    coverageGaps,
    meetingInvites,
    collectionFollowUps,
  });

  // Whom the viewer covers today; while it lasts, that person's work is theirs to do.
  const myPeriods = coverageToday.coverage.filter((c) => c.coverer_id === viewer?.profile.id);
  const coveredWork = await getCoveredWork([...new Set(myPeriods.map((c) => c.absent_profile_id))], today);
  const nowHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

  return (
    <>
      {/* Nobody goes hunting for a notifications setting, so the invitation
          comes to them — once, dismissible, and enabling in a single tap. */}
      <PushPrompt />

      <Greeting name={viewer?.profile.name ?? null} today={today} />

      {/* The viewer's day first. What is late from before is counted in "Ahora", not repeated here. */}
      <TodayCard
        items={agendaToday.filter((i) => !((i.kind === 'activity' || i.kind === 'collection') && i.late))}
        today={today}
        kinds={kinds}
        extra={
          <>
            {/* The day's visit route, and the work of whoever the viewer covers — each only when there is one. */}
            <TodayPlanCard activities={todayPlan} kinds={kinds} points={visitPoints} viewerId={viewer?.profile.id ?? ''} routeOnly />
            {myPeriods.length > 0 && (
              <div className="mt-4">
                <CoveringNowCard periods={myPeriods} now={nowHm} activities={coveredWork.activities} inventories={coveredWork.inventories} />
              </div>
            )}
          </>
        }
      />

      {/* What is late or urgent. */}
      <div className="mb-4">
        <NowCard items={nowItems} />
      </div>

      {business ? (
        <BusinessFigures
          orders={{
            total: orders.delivering.length,
            ready: orders.delivering.filter((o) => o.ready_at).length,
            shipped: orders.delivering.filter((o) => o.shipped_at).length,
          }}
          sales={business.sales}
          incidents={business.incidents}
          activities={{ ...activities, overdue: data.overdue.length, blocked: data.blocked.length }}
        />
      ) : (
        <ProgressFigures
          activities={activities}
          prepare={{ done: orders.toPrepare.filter((o) => o.ready_at).length, total: orders.toPrepare.length }}
          counts={{ done: countsToday.filter((r) => r.status !== 'in_progress').length, total: countsToday.length }}
          plan={sales ? { done: todayPlan.filter((a) => a.status !== 'planned').length, total: todayPlan.length } : undefined}
          planLate={sales ? planLate : undefined}
        />
      )}

      {/* The cards: one column on a phone or a narrow window, two on a computer —
          the page is about 780px wide beside the menu, too narrow for three. */}
      <div className="columns-1 gap-4 lg:columns-2">
        <Tile>
          <OrderWidgets
            toPrepare={orders.toPrepare}
            carriedOver={orders.carriedOver}
            delivering={orders.delivering}
            canManage={canManageOrders}
          />
        </Tile>
        {/* Renders nothing unless a count is due or late, so it never becomes
            empty furniture people learn to scroll past. */}
        <Tile><InventoryWidget dueToday={inventory.dueToday} overdue={inventory.overdue} /></Tile>
        {/* Nothing unless someone is away today. */}
        {workingHours && (
          <Tile>
            <CoverageTodayCard
              today={today}
              away={coverageToday.away}
              coverage={coverageToday.coverage}
              needsCover={needsCover}
              hours={workingHours}
              viewerId={viewer?.profile.id ?? ''}
            />
          </Tile>
        )}
        <Tile><PendingEvaluations evaluations={evaluations} /></Tile>
        {viewer && <Tile><NotesCard notes={quickNotes} viewerId={viewer.profile.id} /></Tile>}
        <Tile><QuietCustomersCard customers={quiet} /></Tile>
        <Tile><CelebrationsCard celebrations={celebrations} /></Tile>
        {/* Personal follow-ups, in their own cards and their own counts — never
            folded into the figures above, which count team work. */}
        {viewer && reminders && personalTasks && (
          <ReminderWidgets
            viewerId={viewer.profile.id}
            // Today's reminders are in "Hoy"; the card keeps what is late, what is coming, and quick creation.
            reminders={{ ...reminders, today: [] }}
            tasks={personalTasks}
            nowIso={nowIso}
          />
        )}
      </div>

      {plans && (
        <div className="mt-2">
          <TeamTodayCard areas={teamToday} />
        </div>
      )}

      <div className="mt-2">
        <DashboardView data={myData} showUpcoming={false} canSkip={plans} />
      </div>
    </>
  );
}
