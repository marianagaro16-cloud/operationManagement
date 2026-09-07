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
  const [data, orders, inventory] = await Promise.all([
    getDashboardData(plans ? 7 : 0),
    getOrderDashboardSummary(today),
    // A short horizon: the dashboard only surfaces what is due now or late.
    // The forward view lives on the inventory screen.
    getInventoryDashboard(1),
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
          done: orders.toPrepare.filter((o) => o.progress.isComplete).length,
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
      <DashboardView data={data} showUpcoming={plans} />
    </>
  );
}
