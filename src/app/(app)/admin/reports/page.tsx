import { getOrdersByDelivery } from '@/server/orders';
import { businessToday } from '@/lib/datetime';
import {
  computeOrderReport,
  customRange,
  periodRange,
  type ReportPeriod,
} from '@/domain/orders/reporting';
import { OrderReportView } from '@/components/orders/order-report-view';

export const dynamic = 'force-dynamic';

const PERIODS: ReportPeriod[] = ['day', 'week', 'month', 'year', 'custom'];

const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { period?: string; date?: string; from?: string; to?: string };
}) {
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

  // Reuses the existing order query — no reporting tables, no duplicated data.
  const orders = await getOrdersByDelivery({ from: range.start, to: range.end });

  return <OrderReportView report={computeOrderReport(orders, range)} anchor={anchor} />;
}
