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
import { CoverageTodayCard } from '@/components/absences/coverage-today-card';
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

  const [data, orders, inventory, reminders, personalTasks, evaluations, celebrations, quiet, todayPlan, planLate, visitPoints, kinds, business, absencesToApprove, coverageToday, needsCover, workingHours, coverageGaps] = await Promise.all([
    getDashboardData(plans ? 7 : 0),
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
  ]);

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
    overdueActivities: data.overdue.length,
    blockedActivities: plans ? data.blocked.length : 0,
    urgentOrders,
    overdueCounts: inventory.overdue.length,
    countsToday: inventory.dueToday.filter((r) => r.status === 'in_progress').length,
    overdueReminders: reminders?.overdueTotal ?? 0,
    overduePersonalTasks: (personalTasks?.open ?? []).filter(
      (task) => personalTaskPhase(task.status, task.due_date, task.due_time, nowIso) === 'overdue',
    ).length,
    planLate,
    planToday: todayPlan.filter((a) => a.status === 'planned').length,
    evaluationsDue: evaluations.filter((e) => e.request.deadline === today).length,
    absencesToApprove,
    coverageGaps,
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
          the page is about 780px wide beside the menu, too narrow for three. "Now" first. */}
      <div className="columns-1 gap-4 lg:columns-2">
        <Tile><NowCard items={nowItems} /></Tile>
        {/* Nothing unless the viewer covers someone today. */}
        <Tile>
          <CoveringNowCard periods={myPeriods} now={nowHm} activities={coveredWork.activities} inventories={coveredWork.inventories} />
        </Tile>
        <Tile>
          <OrderWidgets
            toPrepare={orders.toPrepare}
            carriedOver={orders.carriedOver}
            delivering={orders.delivering}
            canManage={canManageOrders}
          />
        </Tile>
        <Tile><TodayPlanCard activities={todayPlan} kinds={kinds} points={visitPoints} viewerId={viewer?.profile.id ?? ''} /></Tile>
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
        <Tile><QuietCustomersCard customers={quiet} /></Tile>
        <Tile><CelebrationsCard celebrations={celebrations} /></Tile>
        {/* Personal follow-ups, in their own cards and their own counts — never
            folded into the figures above, which count team work. */}
        {viewer && reminders && personalTasks && (
          <ReminderWidgets
            viewerId={viewer.profile.id}
            reminders={reminders}
            tasks={personalTasks}
            nowIso={nowIso}
          />
        )}
      </div>

      <div className="mt-2">
        <DashboardView data={data} showUpcoming={plans} canSkip={plans} />
      </div>
    </>
  );
}
