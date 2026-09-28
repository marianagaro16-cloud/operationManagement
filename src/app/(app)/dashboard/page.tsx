import { getDashboardData, getViewer } from '@/server/data';
import { getOrderDashboardSummary } from '@/server/orders';
import { getInventoryDashboard } from '@/server/inventory';
import { businessToday } from '@/lib/datetime';
import { DashboardView } from '@/components/tasks/dashboard-view';
import { DaySummaryStrip } from '@/components/tasks/day-summary-strip';
import { OrderWidgets } from '@/components/orders/order-widgets';
import { UrgentAlert } from '@/components/orders/urgent-alert';
import { InventoryWidget } from '@/components/inventory/inventory-widget';
import { PushPrompt } from '@/components/shell/push-prompt';
import { getDashboardReminders, getPersonalTasks } from '@/server/reminders';
import { ReminderWidgets } from '@/components/reminders/reminder-widgets';
import { canUseReminders, isSales } from '@/lib/authz';
import { getMyPendingEvaluations } from '@/server/hr-evaluations';
import { PendingEvaluations } from '@/components/hr/pending-evaluations';
import { getUpcomingCelebrations } from '@/server/hr-celebrations';
import { CelebrationsCard } from '@/components/hr/celebrations-card';
import { getMyDueProspects, getQuietCustomers, getStartPoint, getVisitDay } from '@/server/sales';
import { TodayVisitsCard } from '@/components/sales/today-visits-card';
import { DueProspectsCard } from '@/components/sales/due-prospects-card';
import { QuietCustomersCard } from '@/components/sales/quiet-customers-card';

// Always render fresh: task and order state change constantly during a shift.
export const dynamic = 'force-dynamic';

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
  const [data, orders, inventory, reminders, personalTasks, evaluations, celebrations, quiet, dueProspects, todayVisits, visitStart] = await Promise.all([
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
    viewer?.profile.team === 'sales' ? getQuietCustomers() : [],
    // Prospects whose next step is today or overdue, for whoever is responsible.
    viewer ? getMyDueProspects(today) : [],
    // The viewer's own visits today, with the route: whoever plans visits, in sales.
    viewer && isSales(viewer.role, viewer.profile.team) ? getVisitDay(viewer.profile.id, today) : [],
    viewer && isSales(viewer.role, viewer.profile.team) ? getStartPoint(viewer.profile.id) : null,
  ]);

  const countsToday = [...inventory.overdue, ...inventory.dueToday];

  return (
    <>
      {/* Nobody goes hunting for a notifications setting, so the invitation
          comes to them — once, dismissible, and enabling in a single tap. */}
      <PushPrompt />

      {/* The one place the three streams are reconciled. Above the widgets,
          because it is the question they each answer only a third of. */}
      <DaySummaryStrip
        tasks={{
          done: data.dailyToday.filter((o) => o.status !== 'pending').length
            + data.extraToday.filter((o) => o.status !== 'pending').length,
          total: data.dailyToday.length + data.extraToday.length,
        }}
        prepare={{
          done: orders.toPrepare.filter((o) => o.ready_at).length,
          total: orders.toPrepare.length,
        }}
        counts={{
          done: countsToday.filter((r) => r.status !== 'in_progress').length,
          total: countsToday.length,
        }}
      />

      {/* Deadline pressure outranks everything else on the page. Carried-over
          work is included: an order left short yesterday and delivering this
          morning is exactly what this alert exists for, and it used to be
          invisible here because the query matched today's date exactly. */}
      <UrgentAlert orders={[...orders.toPrepare, ...orders.carriedOver]} />
      {/* Orders summarise into two tiles; today's TASKS remain the focus. */}
      <OrderWidgets
        toPrepare={orders.toPrepare}
        carriedOver={orders.carriedOver}
        delivering={orders.delivering}
        canManage={canManageOrders}
      />
      {/* Renders nothing unless a count is due or late, so it never becomes
          empty furniture people learn to scroll past. */}
      <InventoryWidget dueToday={inventory.dueToday} overdue={inventory.overdue} />
      <PendingEvaluations evaluations={evaluations} />
      <CelebrationsCard celebrations={celebrations} />
      <TodayVisitsCard visits={todayVisits} start={visitStart} />
      <DueProspectsCard prospects={dueProspects} today={today} />
      <QuietCustomersCard customers={quiet} />
      {/* Personal follow-ups, in their own cards and their own counts — never
          folded into the summary strip above, which counts team work. */}
      {viewer && reminders && personalTasks && (
        <ReminderWidgets
          viewerId={viewer.profile.id}
          reminders={reminders}
          tasks={personalTasks}
          nowIso={new Date().toISOString()}
        />
      )}
      <DashboardView data={data} showUpcoming={plans} canSkip={plans} />
    </>
  );
}
