import { notFound } from 'next/navigation';
import { getCustomers, getDeliveryMethods, getOrder, getProducts } from '@/server/orders';
import { getViewer } from '@/server/data';
import { OrderDetail } from '@/components/orders/order-detail';

export const dynamic = 'force-dynamic';

/**
 * One order at its own URL.
 *
 * Deliberately NOT gated on `orders.manage` the way `/orders` is. That gate
 * exists because the order BOOK — browsing every customer, date and quantity —
 * is not a floor worker's screen. A single order they are preparing is a
 * different thing: lot control shows them its reference, and being unable to
 * open it is what made the reference decorative.
 *
 * RLS still decides what they can read, and the edit controls inside follow
 * `orders.manage`, so this widens navigation without widening authority.
 */
export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  const canManage = viewer?.can('orders.manage') ?? false;

  const order = await getOrder(params.id);
  if (!order) notFound();

  // The editor needs the pickers; someone who cannot edit never pays for them.
  const [customers, products, deliveryMethods] = canManage
    ? await Promise.all([getCustomers(), getProducts(), getDeliveryMethods()])
    : [[], [], []];

  return (
    <OrderDetail
      order={order}
      customers={customers}
      products={products}
      deliveryMethods={deliveryMethods}
      canManage={canManage}
    />
  );
}
