import { getOrdersByDelivery } from '@/server/orders';
import { businessToday } from '@/lib/datetime';
import { computeOrderReport, periodRange, type ReportPeriod } from '@/domain/orders/reporting';
import { OrderReportView } from '@/components/orders/order-report-view';

export const dynamic = 'force-dynamic';

const PERIODS: ReportPeriod[] = ['day', 'week', 'month'];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { period?: string; date?: string };
}) {
  const period: ReportPeriod = PERIODS.includes(searchParams.period as ReportPeriod)
    ? (searchParams.period as ReportPeriod)
    : 'month';

  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '')
    ? (searchParams.date as string)
    : businessToday();

  const range = periodRange(period, anchor);

  // Reuses the existing order query — no reporting tables, no duplicated data.
  const orders = await getOrdersByDelivery({ from: range.start, to: range.end });

  return <OrderReportView report={computeOrderReport(orders, range)} anchor={anchor} />;
}
