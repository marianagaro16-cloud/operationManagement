import { getDashboardData, getProfile } from '@/server/data';
import { getOrderDashboardSummary } from '@/server/orders';
import { businessToday } from '@/lib/datetime';
import { DashboardView } from '@/components/tasks/dashboard-view';
import { OrderWidgets } from '@/components/orders/order-widgets';
import { UrgentAlert } from '@/components/orders/urgent-alert';
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
  const [data, orders] = await Promise.all([
    getDashboardData(isAdmin ? 7 : 0),
    getOrderDashboardSummary(today),
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
      <DashboardView data={data} showUpcoming={isAdmin} />
    </>
  );
}
