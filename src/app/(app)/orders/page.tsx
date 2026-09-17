import { DateTime } from 'luxon';
import { getBoxTypes, getBrands, getCustomers, getDeliveryMethods, getOrdersBoard, getOrdersByDelivery, getProducts } from '@/server/orders';
import { getIncidentCategories, getIncidentTypes } from '@/server/incidents';
import { getViewer } from '@/server/data';
import { monthRange } from '@/domain/orders/scheduling';
import { customRange } from '@/domain/orders/reporting';
import { ORDERS_GO_LIVE } from '@/domain/orders/config';
import { BUSINESS_TZ, addDays, businessToday } from '@/lib/datetime';
import { filterByQuery } from '@/lib/search';
import { productLabel } from '@/types/orders';
import { displayName } from '@/lib/utils';
import { OrderControl } from '@/components/orders/order-control';
import { OrdersBoard, OrdersTabs, type OrdersMode, type OrdersTab } from '@/components/orders/orders-board';
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
    from?: string;
    to?: string;
    tab?: string;
    date?: string;
    mode?: string;
  };
}) {
  // The month is only a filter over a single orders table — never a separate
  // table or file per month, which is what made the Excel history unsearchable.
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '')
    ? (searchParams.month as string)
    : DateTime.fromISO(businessToday(), { zone: BUSINESS_TZ }).toFormat('yyyy-MM');

  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') redirect('/dashboard');
  const canManage = viewer.can('orders.manage');

  /*
   * Which tab. The stage tabs are for everyone; All — the monthly order book,
   * where orders are created, edited and imported — is orders.manage only.
   * A link from elsewhere carrying order-book filters (a report's customer
   * link, an old bookmark) opens All for someone who may see it.
   */
  const hasBookFilters = Boolean(
    searchParams.month || searchParams.customer || searchParams.method || searchParams.status
    || searchParams.brand || searchParams.q || searchParams.from || searchParams.to,
  );
  const requested = searchParams.tab as OrdersTab | undefined;
  const tab: OrdersTab =
    requested === 'all' || (!requested && hasBookFilters)
      ? (canManage ? 'all' : 'to_prepare')
      : requested === 'ready' || requested === 'shipped' ? requested : 'to_prepare';

  if (tab !== 'all') {
    const today = businessToday();
    // A plain user works today only — whatever the URL says. Managers can move
    // between days and key the day on delivery instead of preparation.
    const date = canManage && isDate(searchParams.date) ? searchParams.date : today;
    const mode: OrdersMode = canManage && searchParams.mode === 'delivery' ? 'delivery' : 'preparation';
    const [board, boxTypes] = await Promise.all([getOrdersBoard(date, mode, date === today), getBoxTypes()]);
    return (
      <OrdersBoard
        tab={tab}
        date={date}
        today={today}
        mode={mode}
        canManage={canManage}
        toPrepare={board.toPrepare}
        carriedOver={board.carriedOver}
        ready={board.ready}
        shipped={board.shipped}
        openDays={board.openDays}
        boxTypes={boxTypes}
      />
    );
  }

  const query = (searchParams.q ?? '').trim();

  // An explicit delivery-date range, when both ends are given. Reversed ends
  // are swapped and an over-long span is clamped, by the same rule the reports
  // use. With one end missing the range is half-typed and ignored.
  const dateRange =
    isDate(searchParams.from) && isDate(searchParams.to)
      ? customRange(searchParams.from, searchParams.to)
      : null;

  // A text search that only looked inside the open month would be a worse
  // version of the Excel it replaced: finding an order from three months ago
  // meant stepping month by month with the customer filter reapplied. The
  // month is just a range over one table, so a query simply widens the range —
  // unless a date range was chosen, which is then what the search looks in.
  const { start, end } = dateRange
    ? dateRange
    : query
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
      tabs={<OrdersTabs active="all" canManage />}
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
        from: dateRange?.start,
        to: dateRange?.end,
      }}
      canManage
      currentUserName={displayName(viewer.profile)}
      incidentCategories={incidentCategories}
      incidentTypes={incidentTypes}
      canReportIncident={canReportIncident}
    />
  );
}

function isDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}
