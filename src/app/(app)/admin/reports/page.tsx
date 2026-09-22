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
import { getOccurrencesInRange, getUsers, getViewer } from '@/server/data';
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
import { ReportTabsProvider } from '@/components/reports/report-shell';
import { allowedReportTabs, type ReportTab } from '@/components/reports/report-tabs';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { DateTime } from 'luxon';
import { getLiveReport, getReportSnapshots } from '@/server/incidents';
import { IncidentReportView } from '@/components/incidents/incident-report-view';
import { buildLiveReceptionReport, getReceptionReportSnapshots } from '@/server/goods-reception';
import { ReceptionReports } from '@/components/admin/reception-reports';
import { monthRange } from '@/domain/orders/scheduling';
import { BUSINESS_TZ } from '@/lib/datetime';
import { LOCALE_COOKIE, resolveLocale } from '@/i18n/config';
import type { Viewer } from '@/server/data';

export const dynamic = 'force-dynamic';

const PERIODS: ReportPeriod[] = ['day', 'week', 'month', 'year', 'custom'];

const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');

/**
 * Informes: every report, one tab each.
 *
 * ONE period model — periodRange() — drives the period tabs. /admin/statistics used
 * to be a separate screen computing its own bounds inline, so the two could
 * disagree about what a month was; and the inventory report existed in
 * server/inventory.ts with no screen at all.
 *
 * Incidents and Reception are monthly and keep saved versions, so they bring
 * their own month controls; they used to be screens of their own.
 *
 * Only the tab's own data is fetched: opening Tasks does not query orders.
 */
export default async function ReportsPage({ searchParams }: { searchParams: ReportSearchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/dashboard');

  const tabs = allowedReportTabs(viewer);
  if (tabs.length === 0) redirect('/admin');

  return (
    <ReportTabsProvider tabs={tabs}>
      {await ReportTabContent({ searchParams, tabs, viewer })}
    </ReportTabsProvider>
  );
}

interface ReportSearchParams {
  tab?: string;
  period?: string;
  date?: string;
  from?: string;
  to?: string;
  customer?: string;
  product?: string;
  brand?: string;
  group?: string;
  /** Incidents tab: YYYY-MM. */
  month?: string;
}

async function ReportTabContent({
  searchParams,
  tabs,
  viewer,
}: {
  tabs: ReportTab[];
  searchParams: ReportSearchParams;
  viewer: Viewer;
}) {
  // The first tab this viewer has, when the URL names none or one of another's.
  const tab: ReportTab = tabs.includes(searchParams.tab as ReportTab)
    ? (searchParams.tab as ReportTab)
    : tabs[0];

  if (tab === 'incidents') return incidentsTab(searchParams.month, viewer);
  if (tab === 'reception') return receptionTab(viewer);

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

/**
 * The live incident report for a month, beside the saved ones.
 *
 * "Live" is honest about itself: it is recomputed on every visit and moves as
 * incidents are edited. Freezing it is a deliberate act with a button, and
 * what that button stores is exactly this payload — §42.
 */
async function incidentsTab(monthParam: string | undefined, viewer: Viewer) {
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '')
    ? (monthParam as string)
    : DateTime.fromISO(businessToday(), { zone: BUSINESS_TZ }).toFormat('yyyy-MM');
  const { start, end } = monthRange(month);

  const [payload, snapshots] = await Promise.all([getLiveReport(month, start, end), getReportSnapshots()]);

  // The most recent saved report from an EARLIER month, for the comparison.
  // A saved report of the same month is not a comparison, it is this month.
  const previous = snapshots.find((s) => s.period_month < `${month}-01`);

  return (
    <IncidentReportView
      payload={payload}
      month={month}
      previous={previous}
      snapshots={snapshots}
      canGenerate={viewer.can('incidents.manage')}
    />
  );
}

/**
 * The live reception month, computed by the SAME domain function a snapshot
 * freezes, so the block at the top and the document generated from it can
 * never disagree.
 */
async function receptionTab(viewer: Viewer) {
  const month = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Europe/Zurich' })
    .format(new Date())
    .slice(0, 7);

  // The label for rows with no supplier recorded, in the viewer's language:
  // the domain layer takes it as an argument rather than importing a dictionary.
  const locale = resolveLocale(cookies().get(LOCALE_COOKIE)?.value);
  const unrecorded = locale === 'es' ? 'Sin registrar' : locale === 'de' ? 'Nicht erfasst' : 'Not recorded';

  const [live, snapshots] = await Promise.all([
    buildLiveReceptionReport(month, unrecorded),
    getReceptionReportSnapshots(),
  ]);

  return (
    <ReceptionReports
      liveMonth={month}
      livePayload={live.payload}
      snapshots={snapshots}
      canGenerate={viewer.can('reports.view')}
    />
  );
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value));
}
