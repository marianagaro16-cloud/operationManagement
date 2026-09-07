import { DateTime } from 'luxon';
import { getCustomers, getDeliveryMethods, getOrdersByDelivery, getProducts } from '@/server/orders';
import { getViewer } from '@/server/data';
import { monthRange } from '@/domain/orders/scheduling';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { OrderControl } from '@/components/orders/order-control';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { month?: string; customer?: string; method?: string; status?: string };
}) {
  // The month is only a filter over a single orders table — never a separate
  // table or file per month, which is what made the Excel history unsearchable.
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '')
    ? (searchParams.month as string)
    : DateTime.fromISO(businessToday(), { zone: BUSINESS_TZ }).toFormat('yyyy-MM');

  // Hiding the tab would leave the route reachable by URL, and an approved
  // user can READ orders under RLS — so the gate has to be here too.
  const viewer = await getViewer();
  if (!viewer?.can('orders.manage')) redirect('/dashboard');

  const { start, end } = monthRange(month);

  const [orders, customers, products, deliveryMethods] = await Promise.all([
    getOrdersByDelivery({
      from: start,
      to: end,
      customerId: searchParams.customer,
      deliveryMethodId: searchParams.method,
      status: searchParams.status,
    }),
    getCustomers(),
    getProducts(),
    getDeliveryMethods(),
  ]);

  return (
    <OrderControl
      orders={orders}
      customers={customers}
      products={products}
      deliveryMethods={deliveryMethods}
      month={month}
      filters={{
        customerId: searchParams.customer,
        deliveryMethodId: searchParams.method,
        status: searchParams.status,
      }}
      canManage
    />
  );
}
