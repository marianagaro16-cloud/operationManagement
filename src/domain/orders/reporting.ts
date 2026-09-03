import { DateTime } from 'luxon';
import { BUSINESS_TZ, parseBusinessDate, toBusinessDate, type BusinessDate } from '@/lib/datetime';
import { allocatedQuantity, toQuantity } from './progress';
import type { Order } from '@/types/orders';

/**
 * Order reporting.
 *
 * Pure and free of I/O, like the recurrence engine, so the numbers the
 * business will act on are unit-tested rather than assembled inside a
 * component.
 *
 * Reports are keyed on DELIVERY date: this answers "what did we sell and
 * ship", which is a commercial question. Lotnummerkontrol remains the
 * preparation-date view.
 *
 * Quantities stay counts of packages in each product's own presentation and
 * are never converted or summed across different presentations — 3 boxes and
 * 2 kilos are not 5 of anything.
 */

export type ReportPeriod = 'day' | 'week' | 'month' | 'year' | 'custom';

/** Longest custom range accepted, so a typo cannot ask for a decade. */
export const MAX_CUSTOM_DAYS = 731;

export interface PeriodRange {
  kind: ReportPeriod;
  start: BusinessDate;
  end: BusinessDate;
  /** Stable identifier: 2026-09-03 | 2026-W36 | 2026-09 | 2026 | a range. */
  key: string;
  /** Set when a custom range was clamped to MAX_CUSTOM_DAYS. */
  clamped?: boolean;
}

/**
 * Inclusive Europe/Zurich bounds of the period containing `date`.
 *
 * 'custom' is not a period around a date, so it is built by customRange()
 * and passing it here falls back to the month — the caller should not be
 * asking this question.
 */
export function periodRange(kind: ReportPeriod, date: BusinessDate): PeriodRange {
  const dt = parseBusinessDate(date);
  switch (kind) {
    case 'day':
      return { kind, start: date, end: date, key: date };
    case 'week':
      return {
        kind,
        start: toBusinessDate(dt.startOf('week')),
        end: toBusinessDate(dt.endOf('week')),
        key: `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`,
      };
    case 'month':
      return {
        kind,
        start: toBusinessDate(dt.startOf('month')),
        end: toBusinessDate(dt.endOf('month')),
        key: dt.toFormat('yyyy-MM'),
      };
    case 'year':
      return {
        kind,
        start: toBusinessDate(dt.startOf('year')),
        end: toBusinessDate(dt.endOf('year')),
        key: dt.toFormat('yyyy'),
      };
    case 'custom':
      // A custom range needs two dates; treat a single one as that month.
      return {
        ...periodRange('month', date),
        kind: 'custom',
      };
  }
}

/**
 * An explicit from–to range.
 *
 * Reversed dates are swapped rather than rejected: someone picking the end
 * date first is expressing a range, not an error. Over-long ranges are
 * clamped and flagged so the report says so instead of silently truncating.
 */
export function customRange(from: BusinessDate, to: BusinessDate): PeriodRange {
  let a = parseBusinessDate(from);
  let b = parseBusinessDate(to);
  if (b < a) [a, b] = [b, a];

  let clamped = false;
  const days = Math.round(b.diff(a, 'days').days) + 1;
  if (days > MAX_CUSTOM_DAYS) {
    b = a.plus({ days: MAX_CUSTOM_DAYS - 1 });
    clamped = true;
  }

  const start = toBusinessDate(a);
  const end = toBusinessDate(b);
  return { kind: 'custom', start, end, key: `${start}_${end}`, clamped };
}

/** Move a whole period forward or back, for previous/next navigation. */
export function shiftPeriod(kind: ReportPeriod, date: BusinessDate, delta: number): BusinessDate {
  const dt = parseBusinessDate(date);
  const unit =
    kind === 'day' ? 'days'
      : kind === 'week' ? 'weeks'
        : kind === 'year' ? 'years'
          : 'months';
  return toBusinessDate(dt.plus({ [unit]: delta }));
}

/** Slide a custom range by its own length, keeping the span identical. */
export function shiftCustomRange(range: PeriodRange, delta: number): PeriodRange {
  const a = parseBusinessDate(range.start);
  const b = parseBusinessDate(range.end);
  const days = Math.round(b.diff(a, 'days').days) + 1;
  return customRange(
    toBusinessDate(a.plus({ days: days * delta })),
    toBusinessDate(b.plus({ days: days * delta })),
  );
}

export interface ProductLine {
  productId: string;
  code: string | null;
  name: string;
  /** Units customers asked for. */
  ordered: number;
  /** Units actually allocated to lots. */
  prepared: number;
  /** ordered - prepared, floored at zero. */
  missing: number;
  /** How many order lines this product appeared on. */
  lines: number;
  /** How many distinct customers bought it. */
  customers: number;
}

export interface CustomerLine {
  customerId: string;
  name: string;
  orders: number;
  lines: number;
  ordered: number;
}

export interface CountLine {
  key: string;
  label: string;
  orders: number;
}

export interface DayLine {
  date: BusinessDate;
  orders: number;
  ordered: number;
}

export interface MonthLine {
  /** YYYY-MM */
  month: string;
  orders: number;
  ordered: number;
}

/** Beyond this many days a per-day list is unreadable, so months are used. */
export const DAY_BREAKDOWN_LIMIT = 62;

export interface OrderReport {
  range: PeriodRange;

  /** Orders that count as real business: everything except cancelled. */
  orders: number;
  cancelled: number;
  draft: number;
  samples: number;
  customersServed: number;
  lines: number;

  /** Units ordered and prepared across every counted line. */
  totalOrdered: number;
  totalPrepared: number;
  /** Lines where less was prepared than ordered. */
  shortLines: number;
  /** Of those, the ones with no explanation recorded. */
  unexplainedShortLines: number;
  /** Percentage of ordered units actually prepared. */
  fulfilmentRate: number;

  byProduct: ProductLine[];
  byCustomer: CustomerLine[];
  byDeliveryMethod: CountLine[];
  /** Empty for ranges longer than DAY_BREAKDOWN_LIMIT; use byMonth instead. */
  byDay: DayLine[];
  /** Populated only for ranges too long for a per-day list. */
  byMonth: MonthLine[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Aggregate a set of orders into a report.
 *
 * Cancelled orders are excluded from every quantity and from the product and
 * customer breakdowns — they were not sold — but are still counted, because
 * "we cancelled six orders this month" is itself worth seeing.
 */
export function computeOrderReport(orders: Order[], range: PeriodRange): OrderReport {
  const counted = orders.filter((o) => o.status !== 'cancelled');

  const products = new Map<string, ProductLine & { customerIds: Set<string> }>();
  const customers = new Map<string, CustomerLine>();
  const methods = new Map<string, CountLine>();
  const days = new Map<BusinessDate, DayLine>();

  let lines = 0;
  let totalOrdered = 0;
  let totalPrepared = 0;
  let shortLines = 0;
  let unexplainedShortLines = 0;

  for (const order of counted) {
    // --- per order ---
    const cust = customers.get(order.customer_id) ?? {
      customerId: order.customer_id,
      name: order.customer?.name ?? '—',
      orders: 0,
      lines: 0,
      ordered: 0,
    };
    cust.orders++;
    customers.set(order.customer_id, cust);

    const methodKey = order.delivery_method_id ?? '__none__';
    const method = methods.get(methodKey) ?? {
      key: methodKey,
      label: order.delivery_method?.name ?? '',
      orders: 0,
    };
    method.orders++;
    methods.set(methodKey, method);

    const day = days.get(order.delivery_date) ?? {
      date: order.delivery_date,
      orders: 0,
      ordered: 0,
    };
    day.orders++;

    // --- per line ---
    for (const line of order.lines ?? []) {
      lines++;
      cust.lines++;

      const ordered = toQuantity(line.ordered_quantity);
      const prepared = allocatedQuantity(line.allocations ?? []);
      totalOrdered += ordered;
      totalPrepared += prepared;
      cust.ordered += ordered;
      day.ordered += ordered;

      if (prepared < ordered) {
        shortLines++;
        if (!line.shortfall_reason?.trim()) unexplainedShortLines++;
      }

      const p = products.get(line.product_id) ?? {
        productId: line.product_id,
        code: line.product?.code ?? null,
        // Falls back through the legacy fields so a product imported before
        // the master-data reshape still names itself.
        name: line.product?.name ?? line.product?.family ?? '—',
        ordered: 0,
        prepared: 0,
        missing: 0,
        lines: 0,
        customers: 0,
        customerIds: new Set<string>(),
      };
      p.ordered += ordered;
      p.prepared += prepared;
      p.lines++;
      p.customerIds.add(order.customer_id);
      products.set(line.product_id, p);
    }

    days.set(order.delivery_date, day);
  }

  const byProduct: ProductLine[] = [...products.values()]
    .map(({ customerIds, ...p }) => ({
      ...p,
      ordered: round3(p.ordered),
      prepared: round3(p.prepared),
      missing: round3(Math.max(0, p.ordered - p.prepared)),
      customers: customerIds.size,
    }))
    // Most sold first: that is the question this table exists to answer.
    .sort((a, b) => b.ordered - a.ordered || a.name.localeCompare(b.name));

  const byCustomer = [...customers.values()]
    .map((c) => ({ ...c, ordered: round3(c.ordered) }))
    .sort((a, b) => b.ordered - a.ordered || a.name.localeCompare(b.name));

  const byDeliveryMethod = [...methods.values()].sort((a, b) => b.orders - a.orders);

  // A per-day list is unreadable past a couple of months, so a long range
  // (a year, or a wide custom span) is bucketed by month instead. Exactly
  // one of the two is populated.
  const rangeStart = parseBusinessDate(range.start);
  const rangeEnd = parseBusinessDate(range.end);
  const spanDays = Math.round(rangeEnd.diff(rangeStart, 'days').days) + 1;
  const useDays = spanDays <= DAY_BREAKDOWN_LIMIT;

  const byDay: DayLine[] = [];
  const byMonth: MonthLine[] = [];

  if (useDays) {
    // Every day in the range, so a gap reads as a genuine zero rather than a
    // missing row.
    for (let d = rangeStart; d <= rangeEnd; d = d.plus({ days: 1 })) {
      const key = toBusinessDate(d);
      byDay.push(days.get(key) ?? { date: key, orders: 0, ordered: 0 });
    }
  } else {
    const monthly = new Map<string, MonthLine>();
    for (const line of days.values()) {
      const month = line.date.slice(0, 7);
      const bucket = monthly.get(month) ?? { month, orders: 0, ordered: 0 };
      bucket.orders += line.orders;
      bucket.ordered = round3(bucket.ordered + line.ordered);
      monthly.set(month, bucket);
    }
    // Every month in the range, empty ones included, for the same reason.
    for (let d = rangeStart.startOf('month'); d <= rangeEnd; d = d.plus({ months: 1 })) {
      const month = d.toFormat('yyyy-MM');
      byMonth.push(monthly.get(month) ?? { month, orders: 0, ordered: 0 });
    }
  }

  return {
    range,
    orders: counted.length,
    cancelled: orders.length - counted.length,
    draft: counted.filter((o) => o.status === 'draft').length,
    samples: counted.filter((o) => o.order_type === 'sample').length,
    customersServed: customers.size,
    lines,
    totalOrdered: round3(totalOrdered),
    totalPrepared: round3(totalPrepared),
    shortLines,
    unexplainedShortLines,
    fulfilmentRate:
      totalOrdered === 0 ? 0 : Math.round((totalPrepared / totalOrdered) * 100),
    byProduct,
    byCustomer,
    byDeliveryMethod,
    byDay,
    byMonth,
  };
}

/** Human label for a period, e.g. "31 Aug – 6 Sep 2026". */
export function periodLabel(range: PeriodRange, locale: string): string {
  const start = DateTime.fromISO(range.start, { zone: BUSINESS_TZ }).setLocale(locale);
  const end = DateTime.fromISO(range.end, { zone: BUSINESS_TZ }).setLocale(locale);
  switch (range.kind) {
    case 'day':
      return start.toFormat('cccc d LLLL yyyy');
    case 'week':
      return `${start.toFormat('d LLL')} – ${end.toFormat('d LLL yyyy')}`;
    case 'month':
      return start.toFormat('LLLL yyyy');
    case 'year':
      return start.toFormat('yyyy');
    case 'custom':
      // Drop the repeated year when both ends share one.
      return start.year === end.year
        ? `${start.toFormat('d LLL')} – ${end.toFormat('d LLL yyyy')}`
        : `${start.toFormat('d LLL yyyy')} – ${end.toFormat('d LLL yyyy')}`;
  }
}

/** Rows for a CSV export, so the numbers can leave the app. */
export function productReportToCsv(report: OrderReport): string {
  const header = ['code', 'product', 'ordered', 'prepared', 'missing', 'lines', 'customers'];
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = report.byProduct.map((p) =>
    [p.code ?? '', p.name, p.ordered, p.prepared, p.missing, p.lines, p.customers].map(escape).join(';'),
  );
  return [header.join(';'), ...rows].join('\n');
}
