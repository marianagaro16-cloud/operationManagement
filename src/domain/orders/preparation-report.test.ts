import { describe, it, expect } from 'vitest';
import { computePreparationReport, lotRegisterToCsv, preparationReportToCsv } from './preparation-report';
import { periodRange } from './reporting';
import type { Order } from '@/types/orders';

/** Runs under TZ=America/New_York; every date below is a Zurich business date. */

let seq = 0;
function order(over: Partial<Order> & { lines?: unknown[] } = {}): Order {
  seq++;
  return {
    id: `o${seq}`,
    reference: 1000 + seq,
    customer_id: 'c1',
    order_date: '2026-09-01',
    delivery_date: '2026-09-04',
    delivery_time: null,
    preparation_date: '2026-09-03',
    delivery_method_id: 'm1',
    status: 'confirmed',
    order_type: 'sale',
    note: null,
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
    customer: { id: 'c1', name: 'La Brea' },
    delivery_method: null,
    lines: [],
    ...over,
  } as unknown as Order;
}

const lot = (who: string | null, name: string, quantity: number, at: string) => ({
  id: `a-${Math.random()}`,
  quantity,
  lot_number: 'L1',
  created_by: who,
  created_at: at,
  author: who ? { name, email: `${who}@x` } : null,
});

let lineSeq = 0;
const line = (ordered: number, allocations: ReturnType<typeof lot>[] = [], reason: string | null = null) =>
  ({ id: `l${++lineSeq}`, product_id: 'p1', ordered_quantity: ordered, shortfall_reason: reason, allocations }) as unknown as NonNullable<Order['lines']>[number];

const SEP = periodRange('month', '2026-09-15');
const TODAY = '2026-09-15';
// 10:00 on the 3rd in Zurich is 08:00 UTC.
const ON_THE_3RD = '2026-09-03T08:00:00.000Z';
const ON_THE_4TH = '2026-09-04T08:00:00.000Z';

describe('order state', () => {
  it('is done, in progress or not started', () => {
    const r = computePreparationReport([
      order({ lines: [line(5, [lot('u1', 'Ana', 5, ON_THE_3RD)])] }),
      order({ lines: [line(5, [lot('u1', 'Ana', 2, ON_THE_3RD)])] }),
      order({ lines: [line(5)] }),
    ], SEP, TODAY);
    expect([r.done, r.inProgress, r.notStarted]).toEqual([1, 1, 1]);
    expect(r.completionRate).toBe(33);
  });

  it('counts a line left short WITH a reason as finished', () => {
    const r = computePreparationReport([
      order({ lines: [line(5, [lot('u1', 'Ana', 3, ON_THE_3RD)], 'Only 3 in stock')] }),
    ], SEP, TODAY);
    expect(r.done).toBe(1);
    expect(r.shortLines).toBe(1);
    expect(r.unexplainedShortLines).toBe(0);
  });

  it('counts a product left out WITH a reason as finished and short', () => {
    const r = computePreparationReport([
      order({ lines: [line(5, [lot('u1', 'Ana', 5, ON_THE_3RD)]), line(4, [], 'No stock')] }),
      // Everything left out: nothing leaves, so not done.
      order({ lines: [line(4, [], 'No stock')] }),
    ], SEP, TODAY);
    expect(r.done).toBe(1);
    expect(r.notStarted).toBe(1);
    expect(r.shortLines).toBe(2);
    expect(r.unexplainedShortLines).toBe(0);
  });

  it('does not count a short line without a reason as finished', () => {
    const r = computePreparationReport([
      order({ lines: [line(5, [lot('u1', 'Ana', 3, ON_THE_3RD)])] }),
    ], SEP, TODAY);
    expect(r.done).toBe(0);
    expect(r.unexplainedShortLines).toBe(1);
  });

  it('leaves cancelled orders out entirely', () => {
    const r = computePreparationReport([
      order({ status: 'cancelled', lines: [line(5)] }),
    ], SEP, TODAY);
    expect(r.orders).toBe(0);
  });
});

describe('on time', () => {
  it('is on time when the last lot was recorded on or before the preparation date', () => {
    const r = computePreparationReport([
      order({ lines: [line(2, [lot('u1', 'Ana', 1, ON_THE_3RD), lot('u2', 'Ben', 1, ON_THE_3RD)])] }),
      order({ lines: [line(2, [lot('u1', 'Ana', 1, ON_THE_3RD), lot('u1', 'Ana', 1, ON_THE_4TH)])] }),
    ], SEP, TODAY);
    expect([r.onTime, r.late, r.onTimeRate]).toEqual([1, 1, 50]);
  });

  it('judges the day in Zurich, not in UTC', () => {
    // 23:30 Zurich on the 3rd is 21:30 UTC — still the 3rd either way — but
    // 00:30 Zurich on the 4th is 22:30 UTC on the 3rd, which is late.
    const r = computePreparationReport([
      order({ lines: [line(1, [lot('u1', 'Ana', 1, '2026-09-03T22:30:00.000Z')])] }),
    ], SEP, TODAY);
    expect(r.late).toBe(1);
  });

  it('counts open orders whose preparation date has passed as overdue', () => {
    const r = computePreparationReport([
      order({ preparation_date: '2026-09-10', lines: [line(5)] }),
      order({ preparation_date: '2026-09-20', lines: [line(5)] }),
    ], SEP, TODAY);
    expect(r.overdueOpen).toBe(1);
  });
});

describe('by preparer', () => {
  it('credits each person with their own lots, orders, lines and days', () => {
    const r = computePreparationReport([
      order({ lines: [
        line(2, [lot('u1', 'Ana', 1, ON_THE_3RD), lot('u1', 'Ana', 1, ON_THE_4TH)]),
        line(1, [lot('u2', 'Ben', 1, ON_THE_3RD)]),
      ] }),
      order({ lines: [line(1, [lot('u1', 'Ana', 1, ON_THE_3RD)])] }),
    ], SEP, TODAY);
    expect(r.byPreparer).toEqual([
      { userId: 'u1', name: 'Ana', orders: 2, lots: 3, lines: 2, days: 2 },
      { userId: 'u2', name: 'Ben', orders: 1, lots: 1, lines: 1, days: 1 },
    ]);
    expect(r.rows[0].preparers).toEqual(['Ana', 'Ben']);
  });

  it('still counts a lot whose author is gone, without crediting anyone', () => {
    const r = computePreparationReport([
      order({ lines: [line(1, [lot(null, '', 1, ON_THE_3RD)])] }),
    ], SEP, TODAY);
    expect(r.lots).toBe(1);
    expect(r.done).toBe(1);
    expect(r.byPreparer).toEqual([]);
  });
});

describe('lots per product — the traceability register', () => {
  const productLine = (productId: string, code: string, name: string, ordered: number, allocations: ReturnType<typeof lot>[]) =>
    ({
      id: `l${++lineSeq}`, product_id: productId, ordered_quantity: ordered, shortfall_reason: null, allocations,
      product: { id: productId, code, name, family: name, presentation: null },
    }) as unknown as NonNullable<Order['lines']>[number];

  const withLot = (who: string, name: string, lotNumber: string, quantity: number) => ({ ...lot(who, name, quantity, ON_THE_3RD), lot_number: lotNumber });

  const orders = () => [
    order({ reference: 2001, customer: { name: 'La Brea' } as never, delivery_date: '2026-09-04', lines: [
      productLine('p1', '0073', 'Tortilla 1kg', 5, [withLot('u1', 'Ana', 'L-10', 3), withLot('u2', 'Ben', 'L-9', 2)]),
      productLine('p2', '0012', 'Chorizo', 1, [withLot('u1', 'Ana', 'C-1', 1)]),
    ] }),
    order({ reference: 2002, customer: { name: 'El Catrin' } as never, delivery_date: '2026-09-06', lines: [
      productLine('p1', '0073', 'Tortilla 1kg', 4, [withLot('u2', 'Ben', 'L-10 ', 4)]),
    ] }),
  ];

  it('groups by product, then lot, with quantity, orders, customers and delivery dates', () => {
    const r = computePreparationReport(orders(), SEP, TODAY);
    expect(r.byProductLot.map((p) => [p.code, p.quantity])).toEqual([['0012', 1], ['0073', 9]]);

    const tortilla = r.byProductLot.find((p) => p.code === '0073')!;
    // Numeric-aware: L-9 before L-10. The trailing space typed on one entry
    // does not split L-10 into two lots.
    expect(tortilla.lots.map((l) => l.lotNumber)).toEqual(['L-9', 'L-10']);

    const l10 = tortilla.lots[1];
    expect(l10).toMatchObject({
      quantity: 7,
      customers: ['La Brea', 'El Catrin'],
      firstDelivery: '2026-09-04',
      lastDelivery: '2026-09-06',
      preparers: ['Ana', 'Ben'],
    });
    expect(l10.orders.map((o) => [o.reference, o.customer, o.quantity])).toEqual([
      [2001, 'La Brea', 3],
      [2002, 'El Catrin', 4],
    ]);
  });

  it('adds up two allocations of the same lot on the same order into one entry', () => {
    const r = computePreparationReport([
      order({ reference: 3001, lines: [productLine('p1', '0073', 'Tortilla', 5, [withLot('u1', 'Ana', 'L-1', 2), withLot('u2', 'Ben', 'L-1', 3)])] }),
    ], SEP, TODAY);
    const l1 = r.byProductLot[0].lots[0];
    expect(l1.orders).toEqual([expect.objectContaining({ reference: 3001, quantity: 5 })]);
    expect(r.lotRows).toHaveLength(2);
  });

  it('exports every allocation as its own row, ready for an inspector', () => {
    const r = computePreparationReport(orders(), SEP, TODAY);
    const lines = lotRegisterToCsv(r).split('\n');
    expect(lines[0]).toBe('product_code;product;lot;quantity;order;customer;preparation_date;delivery_date;recorded_at;prepared_by');
    expect(lines).toHaveLength(5);
    expect(lines).toContain('0073;Tortilla 1kg;L-10;4;2002;El Catrin;2026-09-03;2026-09-06;2026-09-03 10:00;Ben');
  });

  it('leaves out lots on cancelled orders — nothing went out', () => {
    const r = computePreparationReport([
      order({ status: 'cancelled', lines: [productLine('p1', '0073', 'Tortilla', 1, [withLot('u1', 'Ana', 'L-1', 1)])] }),
    ], SEP, TODAY);
    expect(r.byProductLot).toEqual([]);
    expect(r.lotRows).toEqual([]);
  });
});

describe('by day and export', () => {
  it('lists every day of the range, with zeros', () => {
    const r = computePreparationReport([
      order({ lines: [line(1, [lot('u1', 'Ana', 1, ON_THE_3RD)])] }),
    ], SEP, TODAY);
    expect(r.byDay).toHaveLength(30);
    expect(r.byDay.find((d) => d.date === '2026-09-03')).toEqual({ date: '2026-09-03', orders: 1, done: 1, onTime: 1 });
    expect(r.byDay.find((d) => d.date === '2026-09-04')).toEqual({ date: '2026-09-04', orders: 0, done: 0, onTime: 0 });
  });

  it('exports one row per order', () => {
    const r = computePreparationReport([
      order({ reference: 1500, customer: { name: 'Los Guapos; GmbH' } as never, lines: [line(1, [lot('u1', 'Ana', 1, ON_THE_3RD)])] }),
    ], SEP, TODAY);
    const [header, row] = preparationReportToCsv(r).split('\n');
    expect(header.split(';')[0]).toBe('reference');
    expect(row).toBe('1500;"Los Guapos; GmbH";2026-09-03;2026-09-04;done;yes;2026-09-03 10:00;Ana;0;0');
  });
});
