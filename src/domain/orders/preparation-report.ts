import { DateTime } from 'luxon';
import { BUSINESS_TZ, parseBusinessDate, toBusinessDate, type BusinessDate } from '@/lib/datetime';
import { lineProgress } from './progress';
import { DAY_BREAKDOWN_LIMIT, type PeriodRange } from './reporting';
import type { Order } from '@/types/orders';

/**
 * Preparation reporting.
 *
 * The order report answers "what did we sell"; this answers "how did the
 * preparation go". So it is keyed on PREPARATION date, and its unit is the
 * work: lots recorded, lines finished, orders done on the day they were due
 * to be prepared — and by whom.
 *
 * Pure, like computeOrderReport(), so the numbers a manager acts on are
 * tested rather than assembled in a component. Everything is derived from
 * the lot allocations themselves: who recorded a lot and when is the only
 * record of who prepared what, and a separate "prepared by" field would be a
 * second truth free to disagree with it.
 */

/**
 * Where an order stands.
 *
 * `done` includes a line left short WITH a reason: an explained shortfall is
 * a finished preparation, and counting it as unfinished would push people to
 * over-allocate rather than write down what happened.
 */
export type PreparationState = 'done' | 'in_progress' | 'not_started';

export interface PreparerLine {
  userId: string;
  name: string;
  /** Distinct orders this person recorded at least one lot on. */
  orders: number;
  lots: number;
  /** Distinct order lines this person recorded at least one lot on. */
  lines: number;
  /** Distinct days (Zurich) they recorded lots on, within this report. */
  days: number;
}

export interface PreparationDayLine {
  date: BusinessDate;
  orders: number;
  done: number;
  onTime: number;
}

export interface PreparationOrderRow {
  id: string;
  reference: number;
  customer: string;
  preparationDate: BusinessDate;
  deliveryDate: BusinessDate;
  state: PreparationState;
  /** For a done order: finished on or before its preparation date. */
  onTime: boolean | null;
  /** The moment the last lot was recorded, or null if none was. */
  lastActivityAt: string | null;
  preparers: string[];
  shortLines: number;
  unexplainedShortLines: number;
}

export interface PreparationReport {
  range: PeriodRange;
  orders: number;
  done: number;
  inProgress: number;
  notStarted: number;
  /** Done on or before the preparation date. */
  onTime: number;
  /** Done, but after the preparation date. */
  late: number;
  /** Not done, and its preparation date has already passed. */
  overdueOpen: number;
  /** Percentage of orders done. */
  completionRate: number;
  /** Percentage of done orders that were done on time. */
  onTimeRate: number;

  lines: number;
  linesComplete: number;
  shortLines: number;
  unexplainedShortLines: number;
  overAllocatedLines: number;
  lots: number;

  byPreparer: PreparerLine[];
  /** Empty for ranges longer than DAY_BREAKDOWN_LIMIT. */
  byDay: PreparationDayLine[];
  /** Every order, for the open list and the CSV. */
  rows: PreparationOrderRow[];
}

const zurichDay = (iso: string): BusinessDate => toBusinessDate(DateTime.fromISO(iso, { zone: BUSINESS_TZ }));

export function computePreparationReport(
  orders: Order[],
  range: PeriodRange,
  today: BusinessDate,
): PreparationReport {
  // Nothing is prepared for a cancelled order.
  const counted = orders.filter((o) => o.status !== 'cancelled');

  const preparers = new Map<string, {
    name: string; orders: Set<string>; lines: Set<string>; days: Set<string>; lots: number;
  }>();
  const days = new Map<BusinessDate, PreparationDayLine>();
  const rows: PreparationOrderRow[] = [];

  let lines = 0, linesComplete = 0, shortLines = 0, unexplained = 0, over = 0, lots = 0;

  for (const order of counted) {
    let orderDone = true;
    let anyAllocation = false;
    let lastActivityAt: string | null = null;
    let orderShort = 0, orderUnexplained = 0;
    const orderPreparers: string[] = [];

    for (const line of order.lines ?? []) {
      lines++;
      const allocations = line.allocations ?? [];
      const p = lineProgress(line.ordered_quantity, allocations, line.shortfall_reason);

      if (p.status === 'complete') linesComplete++;
      if (p.status === 'over_allocated') over++;
      if (p.status === 'partial') {
        shortLines++; orderShort++;
        if (p.needsReason) { unexplained++; orderUnexplained++; }
      }

      const lineDone =
        p.status === 'complete' || p.status === 'over_allocated' || (p.status === 'partial' && !p.needsReason);
      if (!lineDone) orderDone = false;

      for (const a of allocations) {
        anyAllocation = true;
        lots++;
        if (!lastActivityAt || a.created_at > lastActivityAt) lastActivityAt = a.created_at;

        // A lot whose author's account was removed still counts as work done;
        // it just cannot be credited to anybody.
        if (!a.created_by) continue;
        const name = a.author?.name?.trim() || a.author?.email || '—';
        const who = preparers.get(a.created_by) ?? {
          name, orders: new Set<string>(), lines: new Set<string>(), days: new Set<string>(), lots: 0,
        };
        who.lots++;
        who.orders.add(order.id);
        who.lines.add(line.id);
        who.days.add(zurichDay(a.created_at));
        preparers.set(a.created_by, who);
        if (!orderPreparers.includes(name)) orderPreparers.push(name);
      }
    }

    // An order with no lines has nothing to prepare, and nothing prepared.
    const hasLines = (order.lines ?? []).length > 0;
    const state: PreparationState =
      hasLines && orderDone ? 'done' : anyAllocation ? 'in_progress' : 'not_started';
    const onTime =
      state === 'done' ? (lastActivityAt ? zurichDay(lastActivityAt) <= order.preparation_date : true) : null;

    rows.push({
      id: order.id,
      reference: order.reference,
      customer: order.customer?.name ?? '—',
      preparationDate: order.preparation_date,
      deliveryDate: order.delivery_date,
      state,
      onTime,
      lastActivityAt,
      preparers: orderPreparers,
      shortLines: orderShort,
      unexplainedShortLines: orderUnexplained,
    });

    const day = days.get(order.preparation_date) ?? { date: order.preparation_date, orders: 0, done: 0, onTime: 0 };
    day.orders++;
    if (state === 'done') day.done++;
    if (onTime) day.onTime++;
    days.set(order.preparation_date, day);
  }

  const done = rows.filter((r) => r.state === 'done').length;
  const onTime = rows.filter((r) => r.onTime === true).length;

  const start = parseBusinessDate(range.start);
  const end = parseBusinessDate(range.end);
  const spanDays = Math.round(end.diff(start, 'days').days) + 1;
  const byDay: PreparationDayLine[] = [];
  if (spanDays <= DAY_BREAKDOWN_LIMIT) {
    // Every day, so a day with nothing to prepare reads as a zero, not a gap.
    for (let d = start; d <= end; d = d.plus({ days: 1 })) {
      const key = toBusinessDate(d);
      byDay.push(days.get(key) ?? { date: key, orders: 0, done: 0, onTime: 0 });
    }
  }

  return {
    range,
    orders: rows.length,
    done,
    inProgress: rows.filter((r) => r.state === 'in_progress').length,
    notStarted: rows.filter((r) => r.state === 'not_started').length,
    onTime,
    late: done - onTime,
    overdueOpen: rows.filter((r) => r.state !== 'done' && r.preparationDate < today).length,
    completionRate: rows.length === 0 ? 0 : Math.round((done / rows.length) * 100),
    onTimeRate: done === 0 ? 0 : Math.round((onTime / done) * 100),
    lines,
    linesComplete,
    shortLines,
    unexplainedShortLines: unexplained,
    overAllocatedLines: over,
    lots,
    byPreparer: [...preparers.entries()]
      .map(([userId, p]) => ({
        userId, name: p.name, orders: p.orders.size, lots: p.lots, lines: p.lines.size, days: p.days.size,
      }))
      // Most work first; the question is who carried the preparation.
      .sort((a, b) => b.lots - a.lots || a.name.localeCompare(b.name)),
    byDay,
    rows: rows.sort((a, b) =>
      a.preparationDate.localeCompare(b.preparationDate) || a.reference - b.reference),
  };
}

/** One row per order, so the numbers can leave the app and be pivoted. */
export function preparationReportToCsv(report: PreparationReport): string {
  const header = [
    'reference', 'customer', 'preparation_date', 'delivery_date', 'state', 'on_time',
    'last_lot_at', 'prepared_by', 'short_lines', 'unexplained_short_lines',
  ];
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = report.rows.map((r) =>
    [
      r.reference, r.customer, r.preparationDate, r.deliveryDate, r.state,
      r.onTime === null ? '' : r.onTime ? 'yes' : 'no',
      r.lastActivityAt ? DateTime.fromISO(r.lastActivityAt, { zone: BUSINESS_TZ }).toFormat('yyyy-MM-dd HH:mm') : '',
      r.preparers.join(', '), r.shortLines, r.unexplainedShortLines,
    ].map(escape).join(';'),
  );
  return [header.join(';'), ...rows].join('\n');
}
