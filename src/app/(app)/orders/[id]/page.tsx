import { notFound } from 'next/navigation';
import { getCustomers, getDeliveryMethods, getOrder, getProducts } from '@/server/orders';
import { getIncidentCategories, getIncidentsForOrder, getIncidentTypes } from '@/server/incidents';
import { getViewer } from '@/server/data';
import { OrderDetail } from '@/components/orders/order-detail';
import { IncidentLinks } from '@/components/incidents/incident-links';
import type { OrderContext } from '@/components/incidents/incident-dialog';

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
  const canReportIncident = viewer?.can('incidents.manage') ?? false;

  const order = await getOrder(params.id);
  if (!order) notFound();

  // The editor needs the pickers; someone who cannot edit never pays for them.
  const [customers, products, deliveryMethods] = canManage
    ? await Promise.all([getCustomers(), getProducts(), getDeliveryMethods()])
    : [[], [], []];

  // The incident panel. Its own vocabulary is only fetched for somebody who
  // can actually raise one — a read-only viewer sees the list and no form.
  const [incidents, categories, types] = await Promise.all([
    getIncidentsForOrder(order.id),
    canReportIncident ? getIncidentCategories() : Promise.resolve([]),
    canReportIncident ? getIncidentTypes() : Promise.resolve([]),
  ]);

  /**
   * Everything the order already knows, so the incident form asks for none of
   * it — §6. The lot allocations travel too, which is what lets an affected
   * product resolve to the lot it was prepared from without anybody retyping
   * a lot number into a second place.
   */
  const orderContext: OrderContext = {
    id: order.id,
    reference: order.reference,
    customer_id: order.customer_id,
    customer_name: order.customer.name,
    order_date: order.order_date,
    preparation_date: order.preparation_date,
    delivery_date: order.delivery_date,
    delivery_method_name: order.delivery_method?.name ?? null,
    lines: order.lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      product: l.product,
      allocations: (l.allocations ?? []).map((a) => ({ id: a.id, lot_number: a.lot_number })),
    })),
  };

  return (
    <>
      <OrderDetail
        order={order}
        customers={customers}
        products={products}
        deliveryMethods={deliveryMethods}
        canManage={canManage}
      />
      <div className="mt-4">
        <IncidentLinks
          incidents={incidents}
          variant="order"
          order={orderContext}
          customers={customers}
          products={products}
          categories={categories}
          types={types}
          canManage={canReportIncident}
        />
      </div>
    </>
  );
}
