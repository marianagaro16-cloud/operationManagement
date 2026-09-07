import { getOrdersByDelivery } from '@/server/orders';
import { getOccurrencesInRange, getUsers } from '@/server/data';
import { getInventoryReport } from '@/server/inventory';
import { businessToday } from '@/lib/datetime';
import { displayName } from '@/lib/utils';
import { computeStats } from '@/domain/stats';
import {
  computeOrderReport,
  customRange,
  periodRange,
  type ReportPeriod,
} from '@/domain/orders/reporting';
import { OrderReportView } from '@/components/orders/order-report-view';
import { StatsView } from '@/components/admin/stats-view';
import { InventoryReportView } from '@/components/reports/inventory-report-view';
import type { ReportTab } from '@/components/reports/report-shell';

export const dynamic = 'force-dynamic';

const PERIODS: ReportPeriod[] = ['day', 'week', 'month', 'year', 'custom'];
const TABS: ReportTab[] = ['orders', 'tasks', 'inventory'];

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
  searchParams: { tab?: string; period?: string; date?: string; from?: string; to?: string };
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

  // Reuses the existing order query — no reporting tables, no duplicated data.
  const orders = await getOrdersByDelivery({ from: range.start, to: range.end });
  return <OrderReportView report={computeOrderReport(orders, range)} anchor={anchor} />;
}
