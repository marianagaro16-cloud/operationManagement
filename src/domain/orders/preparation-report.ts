import { DateTime } from 'luxon';
import { BUSINESS_TZ, parseBusinessDate, toBusinessDate, type BusinessDate } from '@/lib/datetime';
import { lineProgress, toQuantity } from './progress';
import { DAY_BREAKDOWN_LIMIT, type PeriodRange } from './reporting';
import { productLabel, type Order } from '@/types/orders';

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

/**
 * One lot of one product, across every order it went out on in the period.
 *
 * This is the traceability register: the question an inspection asks is
 * "this lot of this product — how much, to whom, when, prepared by whom",
 * and it must be answerable for a whole period at once, not one lot search
 * at a time.
 */
export interface LotLine {
  lotNumber: string;
  /** Packages allocated from this lot, in the product's own presentation. */
  quantity: number;
  /** Orders this lot went out on, with where each one went. */
  orders: { id: string; reference: number; customer: string; deliveryDate: BusinessDate; quantity: number }[];
  customers: string[];
  firstDelivery: BusinessDate;
  lastDelivery: BusinessDate;
  preparers: string[];
}

export interface ProductLotsLine {
  productId: string;
  code: string | null;
  name: string;
  /** Quantities are summed only within one product — one presentation. */
  quantity: number;
  lots: LotLine[];
}

/** One allocation, flat: the row an inspector's spreadsheet wants. */
export interface LotRow {
  productCode: string | null;
  product: string;
  lotNumber: string;
  quantity: number;
  reference: number;
  customer: string;
  preparationDate: BusinessDate;
  deliveryDate: BusinessDate;
  recordedAt: string;
  preparedBy: string;
}

export interface PreparationReport {
  range: PeriodRange;
  /** Products and the lots each went out from. The heart of the report. */
  byProductLot: ProductLotsLine[];
  /** Every allocation, flat, for the traceability export. */
  lotRows: LotRow[];
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
  const productLots = new Map<string, { code: string | null; name: string; lots: Map<string, LotLine> }>();
  const lotRows: LotRow[] = [];

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

        // --- the traceability register ---
        const quantity = toQuantity(a.quantity);
        const authorName = a.author?.name?.trim() || a.author?.email || '—';
        const customer = order.customer?.name ?? '—';
        const productName = line.product ? productLabel(line.product) : '—';
        // Lot numbers are typed by hand; trimmed so "L123 " and "L123" are one lot.
        const lotNumber = a.lot_number.trim();

        const product = productLots.get(line.product_id) ?? {
          code: line.product?.code ?? null, name: productName, lots: new Map<string, LotLine>(),
        };
        const lotLine = product.lots.get(lotNumber) ?? {
          lotNumber, quantity: 0, orders: [], customers: [], preparers: [],
          firstDelivery: order.delivery_date, lastDelivery: order.delivery_date,
        };
        lotLine.quantity += quantity;
        const onOrder = lotLine.orders.find((o) => o.id === order.id);
        if (onOrder) onOrder.quantity += quantity;
        else lotLine.orders.push({ id: order.id, reference: order.reference, customer, deliveryDate: order.delivery_date, quantity });
        if (!lotLine.customers.includes(customer)) lotLine.customers.push(customer);
        if (a.author && !lotLine.preparers.includes(authorName)) lotLine.preparers.push(authorName);
        if (order.delivery_date < lotLine.firstDelivery) lotLine.firstDelivery = order.delivery_date;
        if (order.delivery_date > lotLine.lastDelivery) lotLine.lastDelivery = order.delivery_date;
        product.lots.set(lotNumber, lotLine);
        productLots.set(line.product_id, product);

        lotRows.push({
          productCode: line.product?.code ?? null,
          product: productName,
          lotNumber,
          quantity,
          reference: order.reference,
          customer,
          preparationDate: order.preparation_date,
          deliveryDate: order.delivery_date,
          recordedAt: a.created_at,
          preparedBy: a.author ? authorName : '—',
        });

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

  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const byProductLot: ProductLotsLine[] = [...productLots.entries()]
    .map(([productId, p]) => {
      const lotsList = [...p.lots.values()]
        .map((l) => ({
          ...l,
          quantity: round3(l.quantity),
          orders: l.orders
            .map((o) => ({ ...o, quantity: round3(o.quantity) }))
            .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.reference - b.reference),
        }))
        .sort((a, b) => a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true }));
      return {
        productId,
        code: p.code,
        name: p.name,
        quantity: round3(lotsList.reduce((sum, l) => sum + l.quantity, 0)),
        lots: lotsList,
      };
    })
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }) || a.name.localeCompare(b.name));

  return {
    range,
    byProductLot,
    lotRows: lotRows.sort((a, b) =>
      a.product.localeCompare(b.product)
      || a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true })
      || a.deliveryDate.localeCompare(b.deliveryDate)
      || a.reference - b.reference),
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

/**
 * The traceability export: one row per lot allocation.
 *
 * Deliberately flat and complete — product, lot, quantity, order, customer,
 * both dates, when it was recorded and by whom — so it can be handed to an
 * inspector as it is, or filtered to one lot in a spreadsheet.
 */
export function lotRegisterToCsv(report: PreparationReport): string {
  const header = [
    'product_code', 'product', 'lot', 'quantity', 'order', 'customer',
    'preparation_date', 'delivery_date', 'recorded_at', 'prepared_by',
  ];
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = report.lotRows.map((r) =>
    [
      r.productCode ?? '', r.product, r.lotNumber, r.quantity, r.reference, r.customer,
      r.preparationDate, r.deliveryDate,
      DateTime.fromISO(r.recordedAt, { zone: BUSINESS_TZ }).toFormat('yyyy-MM-dd HH:mm'),
      r.preparedBy,
    ].map(escape).join(';'),
  );
  return [header.join(';'), ...rows].join('\n');
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
