import { getDashboardData } from '@/server/data';
import { getOrderDashboardSummary } from '@/server/orders';
import { businessToday } from '@/lib/datetime';
import { DashboardView } from '@/components/tasks/dashboard-view';
import { OrderWidgets } from '@/components/orders/order-widgets';

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
      {/* Orders summarise into two tiles; today's TASKS remain the focus. */}
      <OrderWidgets toPrepare={orders.toPrepare} delivering={orders.delivering} />
      <DashboardView data={data} />
    </>
  );
}
