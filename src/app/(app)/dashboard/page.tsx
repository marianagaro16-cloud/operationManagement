import { getDashboardData, getProfile } from '@/server/data';
import { getOrderDashboardSummary } from '@/server/orders';
import { getInventoryDashboard } from '@/server/inventory';
import { businessToday } from '@/lib/datetime';
import { DashboardView } from '@/components/tasks/dashboard-view';
import { OrderWidgets } from '@/components/orders/order-widgets';
import { UrgentAlert } from '@/components/orders/urgent-alert';
import { InventoryWidget } from '@/components/inventory/inventory-widget';
import { PushPrompt } from '@/components/shell/push-prompt';

// Always render fresh: task and order state change constantly during a shift.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const today = businessToday();
  const profile = await getProfile();
  const isAdmin = profile?.role === 'admin';

  // A regular user's dashboard is the current day. Showing a week ahead
  // invites working on tomorrow's list, and buries what is due now.
  // Admins keep the forward view because planning is their job.
  const [data, orders, inventory] = await Promise.all([
    getDashboardData(isAdmin ? 7 : 0),
    getOrderDashboardSummary(today),
    // A short horizon: the dashboard only surfaces what is due now or late.
    // The forward view lives on the inventory screen.
    getInventoryDashboard(1),
  ]);

  return (
    <>
      {/* Nobody goes hunting for a notifications setting, so the invitation
          comes to them — once, dismissible, and enabling in a single tap. */}
      <PushPrompt />
      {/* Deadline pressure outranks everything else on the page. */}
      <UrgentAlert orders={orders.toPrepare} />
      {/* Orders summarise into two tiles; today's TASKS remain the focus. */}
      <OrderWidgets toPrepare={orders.toPrepare} delivering={orders.delivering} />
      {/* Renders nothing unless a count is due or late, so it never becomes
          empty furniture people learn to scroll past. */}
      <InventoryWidget dueToday={inventory.dueToday} overdue={inventory.overdue} />
      <DashboardView data={data} showUpcoming={isAdmin} />
    </>
  );
}
