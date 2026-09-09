import { DateTime } from 'luxon';
import { getBrands, getCustomers, getDeliveryMethods, getOrdersByDelivery, getProducts } from '@/server/orders';
import { getIncidentCategories, getIncidentTypes } from '@/server/incidents';
import { getViewer } from '@/server/data';
import { monthRange } from '@/domain/orders/scheduling';
import { ORDERS_GO_LIVE } from '@/domain/orders/config';
import { BUSINESS_TZ, addDays, businessToday } from '@/lib/datetime';
import { filterByQuery } from '@/lib/search';
import { productLabel } from '@/types/orders';
import { OrderControl } from '@/components/orders/order-control';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** How far past today a text search reaches. Orders are not placed years out. */
const SEARCH_HORIZON_DAYS = 400;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: {
    month?: string;
    customer?: string;
    method?: string;
    status?: string;
    brand?: string;
    q?: string;
  };
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

  const query = (searchParams.q ?? '').trim();

  // A text search that only looked inside the open month would be a worse
  // version of the Excel it replaced: finding an order from three months ago
  // meant stepping month by month with the customer filter reapplied. The
  // month is just a range over one table, so a query simply widens the range.
  const { start, end } = query
    ? { start: ORDERS_GO_LIVE, end: addDays(businessToday(), SEARCH_HORIZON_DAYS) }
    : monthRange(month);

  const canReportIncident = viewer.can('incidents.manage');

  const [found, customers, products, deliveryMethods, brands, incidentCategories, incidentTypes] =
    await Promise.all([
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
      getBrands(),
      // Only for somebody who can actually raise one; a viewer who cannot is
      // never made to pay for the vocabulary.
      canReportIncident ? getIncidentCategories() : Promise.resolve([]),
      canReportIncident ? getIncidentTypes() : Promise.resolve([]),
    ]);

  // Matched on the customer, the reference and the products on the order —
  // the three things somebody actually remembers about one.
  const orders = query
    ? filterByQuery(
        found,
        query,
        (o) =>
          `${o.customer.name} #${o.reference} ${o.reference} ` +
          o.lines.map((l) => `${l.product.code ?? ''} ${productLabel(l.product)}`).join(' '),
      )
    : found;

  /*
   * The brand filter is applied HERE rather than in the query.
   *
   * A brand sits two joins below an order — orders to order_lines to
   * products — so as a PostgREST filter it would need an inner join, and an
   * inner join also trims the embedded lines to the ones that matched. The
   * screen would then show orders missing half their contents, which is not a
   * filtered list but a wrong one. An order is picked, packed and delivered
   * as a unit, so the filter decides which ORDERS appear and never which
   * lines they contain.
   *
   * Only an id that is actually a brand is honoured, so a hand-edited URL
   * narrows the list to nothing visible rather than being passed through.
   */
  const brandId = brands.some((b) => b.id === searchParams.brand) ? searchParams.brand : undefined;
  const visible = brandId
    ? orders.filter((o) => o.lines.some((l) => l.product.brand_id === brandId))
    : orders;

  return (
    <OrderControl
      orders={visible}
      customers={customers}
      products={products}
      deliveryMethods={deliveryMethods}
      brands={brands}
      month={month}
      filters={{
        customerId: searchParams.customer,
        deliveryMethodId: searchParams.method,
        status: searchParams.status,
        brandId,
        query,
      }}
      canManage
      incidentCategories={incidentCategories}
      incidentTypes={incidentTypes}
      canReportIncident={canReportIncident}
    />
  );
}
