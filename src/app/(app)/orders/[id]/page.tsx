import { notFound } from 'next/navigation';
import { getCustomers, getDeliveryMethods, getOrder, getProducts } from '@/server/orders';
import { getIncidentCategories, getIncidentsForOrder, getIncidentTypes } from '@/server/incidents';
import { getViewer } from '@/server/data';
import { OrderDetail } from '@/components/orders/order-detail';
import { IncidentLinks } from '@/components/incidents/incident-links';
import { ReportIncidentButton } from '@/components/incidents/report-incident-button';
import { orderContextFrom } from '@/components/incidents/incident-dialog';

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
   *
   * Built by the shared helper rather than by hand, because Order Control
   * raises the same dialog from its rows and two hand-built objects would
   * drift the day one of them stopped carrying the allocations.
   */
  const orderContext = orderContextFrom(order);

  return (
    <>
      <OrderDetail
        order={order}
        customers={customers}
        products={products}
        deliveryMethods={deliveryMethods}
        canManage={canManage}
        // Beside Edit, because reporting an incident is a thing you do TO
        // this order and that is where a person looks for it.
        headerAction={
          canReportIncident ? (
            <ReportIncidentButton
              order={orderContext}
              customers={customers}
              products={products}
              categories={categories}
              types={types}
            />
          ) : undefined
        }
      />
      {/* The record, below the order it belongs to. Renders nothing at all on
          an order that has never had an incident. */}
      <div className="mt-4">
        <IncidentLinks incidents={incidents} variant="order" />
      </div>
    </>
  );
}
