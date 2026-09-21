import {
  getBrands,
  getCustomers,
  getOrdersByDelivery,
  getOrdersByPreparation,
  getProductCategories,
  getProducts,
  getProductSubcategories,
} from '@/server/orders';
import { computePreparationReport } from '@/domain/orders/preparation-report';
import { PreparationReportView } from '@/components/reports/preparation-report-view';
import { getOccurrencesInRange, getUsers } from '@/server/data';
import { getInventoryReport } from '@/server/inventory';
import { businessToday } from '@/lib/datetime';
import { displayName } from '@/lib/utils';
import { computeStats } from '@/domain/stats';
import {
  computeOrderReport,
  customRange,
  narrowToBrand,
  narrowToProduct,
  periodRange,
  PRODUCT_GROUPINGS,
  type ProductGrouping,
  type ReportPeriod,
} from '@/domain/orders/reporting';
import { OrderReportView } from '@/components/orders/order-report-view';
import { StatsView } from '@/components/admin/stats-view';
import { InventoryReportView } from '@/components/reports/inventory-report-view';
import type { ReportTab } from '@/components/reports/report-shell';

export const dynamic = 'force-dynamic';

const PERIODS: ReportPeriod[] = ['day', 'week', 'month', 'year', 'custom'];
const TABS: ReportTab[] = ['orders', 'preparation', 'tasks', 'inventory'];

const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');

/**
 * Reporting, for all three modules.
 *
 * ONE period model — periodRange() — drives every tab. /admin/statistics used
 * to be a separate screen computing its own bounds inline, so the two could
 * disagree about what a month was; and the inventory report existed in
 * server/inventory.ts with no screen at all.
 *
 * Only the tab's own data is fetched: opening Tasks does not query orders.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: {
    tab?: string;
    period?: string;
    date?: string;
    from?: string;
    to?: string;
    customer?: string;
    product?: string;
    brand?: string;
    group?: string;
  };
}) {
  const tab: ReportTab = TABS.includes(searchParams.tab as ReportTab)
    ? (searchParams.tab as ReportTab)
    : 'orders';

  const period: ReportPeriod = PERIODS.includes(searchParams.period as ReportPeriod)
    ? (searchParams.period as ReportPeriod)
    : 'month';

  const anchor = isDate(searchParams.date) ? searchParams.date : businessToday();

  // A custom range needs both ends. With one missing the request is
  // half-typed, so fall back to the month rather than inventing a boundary.
  const custom =
    period === 'custom' && isDate(searchParams.from) && isDate(searchParams.to)
      ? customRange(searchParams.from, searchParams.to)
      : null;

  const range =
    custom ??
    (period === 'custom'
      ? customRange(periodRange('month', anchor).start, periodRange('month', anchor).end)
      : periodRange(period, anchor));

  if (tab === 'tasks') {
    const [occurrences, users] = await Promise.all([
      getOccurrencesInRange(range.start, range.end),
      getUsers(),
    ]);
    const names = new Map(users.map((u) => [u.id, displayName(u)]));
    return (
      <StatsView
        stats={computeStats(occurrences, businessToday(), names)}
        range={range}
        anchor={anchor}
      />
    );
  }

  if (tab === 'inventory') {
    const report = await getInventoryReport(range.start, range.end);
    return <InventoryReportView report={report} range={range} anchor={anchor} />;
  }

  // Keyed on PREPARATION date — the same rows the preparation screen reads,
  // over a period instead of a day.
  if (tab === 'preparation') {
    const orders = await getOrdersByPreparation(range.start, range.end);
    return (
      <PreparationReportView
        report={computePreparationReport(orders, range, businessToday())}
        anchor={anchor}
      />
    );
  }

  // Only an id that looks like one is honoured, so a hand-edited URL narrows
  // to nothing rather than reaching PostgREST as a malformed uuid.
  const customerId = isUuid(searchParams.customer) ? searchParams.customer : undefined;
  const productId = isUuid(searchParams.product) ? searchParams.product : undefined;
  // A brand id, or 'none' for products nobody has classified.
  const brandId = searchParams.brand === 'none' || isUuid(searchParams.brand) ? searchParams.brand : undefined;

  // Reuses the existing order query — no reporting tables, no duplicated data.
  // Inactive customers, products and brands are offered too: a report looks backwards.
  const grouping: ProductGrouping = PRODUCT_GROUPINGS.includes(searchParams.group as ProductGrouping)
    ? (searchParams.group as ProductGrouping)
    : 'none';

  const [found, customers, products, brands, categories, subcategories] = await Promise.all([
    getOrdersByDelivery({ from: range.start, to: range.end, customerId }),
    getCustomers(true),
    getProducts(true),
    getBrands(true),
    // Inactive too: last year's orders may name a retired category.
    getProductCategories(true),
    getProductSubcategories(true),
  ]);
  const byBrand = brandId ? narrowToBrand(found, brandId) : found;
  const orders = productId ? narrowToProduct(byBrand, productId) : byBrand;

  return (
    <OrderReportView
      report={computeOrderReport(orders, range, { categories, subcategories })}
      anchor={anchor}
      customers={customers}
      products={products}
      brands={brands}
      filters={{ customerId, productId, brandId }}
      grouping={grouping}
      categories={categories}
      subcategories={subcategories}
    />
  );
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value));
}
