import { getDashboardData } from '@/server/data';
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
  const [data, orders] = await Promise.all([
    getDashboardData(7),
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
      <DashboardView data={data} />
    </>
  );
}
