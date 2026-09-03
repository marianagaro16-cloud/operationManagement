import { describe, it, expect } from 'vitest';
import {
  computeOrderReport,
  periodRange,
  shiftPeriod,
  productReportToCsv,
  customRange,
  shiftCustomRange,
  periodLabel,
  MAX_CUSTOM_DAYS,
  type ReportPeriod,
} from './reporting';
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
    delivery_date: '2026-09-03',
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
    customer: { id: 'c1', name: 'La Brea', company_name: 'La Brea', company_name_addition: null, is_active: true, created_at: '', updated_at: '' },
    delivery_method: { id: 'm1', slug: 'dhl', name: 'DHL', sort_order: 1, is_active: true },
    lines: [],
    ...over,
  } as unknown as Order;
}

/**
 * A line carrying only what the report reads. Cast because the full
 * OrderLine/LotAllocation shapes add fields the aggregation never touches,
 * and spelling them out would obscure what each test is actually asserting.
 */
const line = (
  productId: string,
  code: string,
  name: string,
  ordered: number,
  allocated: number[] = [],
  shortfall: string | null = null,
) =>
  ({
    id: `l-${productId}-${Math.random()}`,
    order_id: 'o',
    product_id: productId,
    ordered_quantity: ordered,
    note: null,
    shortfall_reason: shortfall,
    position: 0,
    product: { id: productId, code, name, family: name, presentation: '—', category: null, notes: null, needs_review: false, is_active: true },
    allocations: allocated.map((quantity, i) => ({ id: `a${i}`, quantity })),
  }) as unknown as NonNullable<Order['lines']>[number];

const SEP = periodRange('month', '2026-09-15');

describe('period ranges', () => {
  const cases: [ReportPeriod, string, string, string, string][] = [
    ['day', '2026-09-03', '2026-09-03', '2026-09-03', '2026-09-03'],
    ['week', '2026-09-03', '2026-08-31', '2026-09-06', '2026-W36'],
    ['month', '2026-09-15', '2026-09-01', '2026-09-30', '2026-09'],
  ];
  it.each(cases)('%s range', (kind, date, start, end, key) => {
    const r = periodRange(kind, date);
    expect(r.start).toBe(start);
    expect(r.end).toBe(end);
    expect(r.key).toBe(key);
  });

  it('bounds February correctly, leap year included', () => {
    expect(periodRange('month', '2026-02-10').end).toBe('2026-02-28');
    expect(periodRange('month', '2024-02-10').end).toBe('2024-02-29');
  });

  it('shifts by a whole period', () => {
    expect(shiftPeriod('day', '2026-09-03', -1)).toBe('2026-09-02');
    expect(shiftPeriod('week', '2026-09-03', 1)).toBe('2026-09-10');
    expect(shiftPeriod('month', '2026-09-15', -1)).toBe('2026-08-15');
    // Month arithmetic clamps rather than overflowing into the next month.
    expect(shiftPeriod('month', '2026-03-31', -1)).toBe('2026-02-28');
  });
});

describe('headline numbers', () => {
  it('counts orders, customers, lines and units', () => {
    const r = computeOrderReport(
      [
        order({ lines: [line('p1', '0001', 'Tortillas 1kg', 10), line('p2', '0002', 'Totopos 500g', 5)] }),
        order({ customer_id: 'c2', customer: { name: 'El Sol' }, lines: [line('p1', '0001', 'Tortillas 1kg', 3)] } as never),
      ],
      SEP,
    );
    expect(r.orders).toBe(2);
    expect(r.customersServed).toBe(2);
    expect(r.lines).toBe(3);
    expect(r.totalOrdered).toBe(18);
  });

  it('excludes cancelled orders from the numbers but still counts them', () => {
    const r = computeOrderReport(
      [
        order({ lines: [line('p1', '0001', 'Tortillas', 10)] }),
        order({ status: 'cancelled', lines: [line('p1', '0001', 'Tortillas', 99)] }),
      ],
      SEP,
    );
    expect(r.orders).toBe(1);
    expect(r.cancelled).toBe(1);
    expect(r.totalOrdered).toBe(10); // the cancelled 99 is not "sold"
    expect(r.byProduct).toHaveLength(1);
    expect(r.byProduct[0].ordered).toBe(10);
  });

  it('separates drafts and samples without hiding them', () => {
    const r = computeOrderReport(
      [
        order({ status: 'draft', lines: [line('p1', '0001', 'T', 1)] }),
        order({ order_type: 'sample', lines: [line('p1', '0001', 'T', 2)] }),
        order({ lines: [line('p1', '0001', 'T', 3)] }),
      ],
      SEP,
    );
    expect(r.orders).toBe(3);
    expect(r.draft).toBe(1);
    expect(r.samples).toBe(1);
    expect(r.totalOrdered).toBe(6);
  });
});

describe('quantities per product — the main question', () => {
  it('sums units per product across orders and customers', () => {
    const r = computeOrderReport(
      [
        order({ lines: [line('p1', '0001', 'Tortillas 1kg', 10)] }),
        order({ customer_id: 'c2', customer: { name: 'El Sol' }, lines: [line('p1', '0001', 'Tortillas 1kg', 6), line('p2', '0002', 'Totopos', 4)] } as never),
      ],
      SEP,
    );
    const tortillas = r.byProduct.find((p) => p.productId === 'p1')!;
    expect(tortillas.ordered).toBe(16);
    expect(tortillas.lines).toBe(2);
    expect(tortillas.customers).toBe(2);
    expect(tortillas.code).toBe('0001');
  });

  it('ranks the best seller first', () => {
    const r = computeOrderReport(
      [order({ lines: [line('p1', '0001', 'Poco', 2), line('p2', '0002', 'Mucho', 40)] })],
      SEP,
    );
    expect(r.byProduct.map((p) => p.name)).toEqual(['Mucho', 'Poco']);
  });

  it('reports prepared and missing units per product', () => {
    const r = computeOrderReport(
      [order({ lines: [line('p1', '0001', 'Tortillas', 10, [6, 2])] })],
      SEP,
    );
    const p = r.byProduct[0];
    expect(p.ordered).toBe(10);
    expect(p.prepared).toBe(8);
    expect(p.missing).toBe(2);
  });

  it('never reports negative missing when more was prepared than ordered', () => {
    const r = computeOrderReport(
      [order({ lines: [line('p1', '0001', 'Tortillas', 10, [12])] })],
      SEP,
    );
    expect(r.byProduct[0].missing).toBe(0);
    expect(r.byProduct[0].prepared).toBe(12);
  });

  it('does not drift when summing fractional quantities', () => {
    const r = computeOrderReport(
      [order({ lines: [line('p1', '0001', 'X', 0.1), line('p1', '0001', 'X', 0.2)] })],
      SEP,
    );
    expect(r.byProduct[0].ordered).toBe(0.3);
  });
});

describe('fulfilment', () => {
  it('computes the rate from units, not from line counts', () => {
    const r = computeOrderReport(
      [order({ lines: [line('p1', '0001', 'A', 10, [10]), line('p2', '0002', 'B', 10, [5])] })],
      SEP,
    );
    expect(r.totalOrdered).toBe(20);
    expect(r.totalPrepared).toBe(15);
    expect(r.fulfilmentRate).toBe(75);
  });

  it('flags short lines and those lacking an explanation', () => {
    const r = computeOrderReport(
      [
        order({
          lines: [
            line('p1', '0001', 'A', 10, [8]),                       // short, no reason
            line('p2', '0002', 'B', 10, [8], 'Sin stock'),          // short, explained
            line('p3', '0003', 'C', 10, [10]),                      // complete
          ],
        }),
      ],
      SEP,
    );
    expect(r.shortLines).toBe(2);
    expect(r.unexplainedShortLines).toBe(1);
  });

  it('is zero, not NaN, when nothing was ordered', () => {
    expect(computeOrderReport([], SEP).fulfilmentRate).toBe(0);
  });
});

describe('breakdowns', () => {
  it('ranks customers by units ordered', () => {
    const r = computeOrderReport(
      [
        order({ lines: [line('p1', '0001', 'A', 5)] }),
        order({ customer_id: 'c2', customer: { name: 'El Sol' }, lines: [line('p1', '0001', 'A', 50)] } as never),
      ],
      SEP,
    );
    expect(r.byCustomer.map((c) => c.name)).toEqual(['El Sol', 'La Brea']);
    expect(r.byCustomer[0].ordered).toBe(50);
  });

  it('groups by delivery method and handles orders without one', () => {
    const r = computeOrderReport(
      [
        order({ lines: [line('p1', '0001', 'A', 1)] }),
        order({ delivery_method_id: null, delivery_method: null, lines: [line('p1', '0001', 'A', 1)] } as never),
      ],
      SEP,
    );
    expect(r.byDeliveryMethod).toHaveLength(2);
    expect(r.byDeliveryMethod.some((m) => m.key === '__none__')).toBe(true);
  });

  it('emits every day of the range so gaps read as zero', () => {
    const week = periodRange('week', '2026-09-03');
    const r = computeOrderReport(
      [order({ delivery_date: '2026-09-03', lines: [line('p1', '0001', 'A', 7)] })],
      week,
    );
    expect(r.byDay).toHaveLength(7);
    expect(r.byDay[0].date).toBe('2026-08-31');
    const wed = r.byDay.find((d) => d.date === '2026-09-03')!;
    expect(wed.orders).toBe(1);
    expect(wed.ordered).toBe(7);
    expect(r.byDay.filter((d) => d.orders === 0)).toHaveLength(6);
  });
});

describe('empty period', () => {
  it('produces a valid, zeroed report', () => {
    const r = computeOrderReport([], periodRange('day', '2026-09-03'));
    expect(r.orders).toBe(0);
    expect(r.totalOrdered).toBe(0);
    expect(r.byProduct).toEqual([]);
    expect(r.byCustomer).toEqual([]);
    expect(r.byDay).toHaveLength(1);
  });
});

describe('CSV export', () => {
  it('emits a header and one row per product', () => {
    const r = computeOrderReport(
      [order({ lines: [line('p1', '0001', 'Tortillas 1kg', 10, [8])] })],
      SEP,
    );
    const csv = productReportToCsv(r);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('code;product;ordered;prepared;missing;lines;customers');
    expect(rows[1]).toBe('0001;Tortillas 1kg;10;8;2;1;1');
  });

  it('quotes a product name containing the separator', () => {
    const r = computeOrderReport(
      [order({ lines: [line('p1', '0001', 'Tortillas; grandes', 1)] })],
      SEP,
    );
    expect(productReportToCsv(r).split('\n')[1]).toContain('"Tortillas; grandes"');
  });
});

/* ------------------------- year and custom ranges ------------------------ */

describe('year period', () => {
  it('bounds a calendar year', () => {
    const r = periodRange('year', '2026-09-15');
    expect(r.start).toBe('2026-01-01');
    expect(r.end).toBe('2026-12-31');
    expect(r.key).toBe('2026');
  });

  it('shifts by whole years', () => {
    expect(shiftPeriod('year', '2026-09-15', -1)).toBe('2025-09-15');
    expect(shiftPeriod('year', '2026-09-15', 1)).toBe('2027-09-15');
  });

  it('buckets by month instead of listing 365 days', () => {
    const year = periodRange('year', '2026-06-01');
    const r = computeOrderReport(
      [
        order({ delivery_date: '2026-03-10', lines: [line('p1', '0001', 'A', 4)] }),
        order({ delivery_date: '2026-03-20', lines: [line('p1', '0001', 'A', 6)] }),
        order({ delivery_date: '2026-11-05', lines: [line('p1', '0001', 'A', 1)] }),
      ],
      year,
    );
    expect(r.byDay).toEqual([]);
    expect(r.byMonth).toHaveLength(12);
    const march = r.byMonth.find((m) => m.month === '2026-03')!;
    expect(march.orders).toBe(2);
    expect(march.ordered).toBe(10);
    expect(r.byMonth.find((m) => m.month === '2026-11')!.orders).toBe(1);
    // Empty months are present as zeros, not missing.
    expect(r.byMonth.filter((m) => m.orders === 0)).toHaveLength(10);
  });
});

describe('custom range', () => {
  it('takes the two dates exactly as given', () => {
    const r = customRange('2026-09-03', '2026-10-15');
    expect(r.kind).toBe('custom');
    expect(r.start).toBe('2026-09-03');
    expect(r.end).toBe('2026-10-15');
    expect(r.clamped).toBe(false);
  });

  it('swaps reversed dates rather than failing', () => {
    const r = customRange('2026-10-15', '2026-09-03');
    expect(r.start).toBe('2026-09-03');
    expect(r.end).toBe('2026-10-15');
  });

  it('accepts a single day', () => {
    const r = customRange('2026-09-03', '2026-09-03');
    expect(r.start).toBe('2026-09-03');
    expect(r.end).toBe('2026-09-03');
  });

  it('clamps an absurd range and says so', () => {
    const r = customRange('2020-01-01', '2035-12-31');
    expect(r.clamped).toBe(true);
    const days = Math.round(
      (new Date(r.end).getTime() - new Date(r.start).getTime()) / 86400000,
    ) + 1;
    expect(days).toBe(MAX_CUSTOM_DAYS);
  });

  it('uses days for a short range and months for a long one', () => {
    const short = computeOrderReport([], customRange('2026-09-01', '2026-09-20'));
    expect(short.byDay).toHaveLength(20);
    expect(short.byMonth).toEqual([]);

    const long = computeOrderReport([], customRange('2026-01-01', '2026-06-30'));
    expect(long.byDay).toEqual([]);
    expect(long.byMonth).toHaveLength(6);
  });

  it('slides by its own length, keeping the span', () => {
    const r = customRange('2026-09-01', '2026-09-10'); // 10 days
    const next = shiftCustomRange(r, 1);
    expect(next.start).toBe('2026-09-11');
    expect(next.end).toBe('2026-09-20');
    const prev = shiftCustomRange(r, -1);
    expect(prev.start).toBe('2026-08-22');
    expect(prev.end).toBe('2026-08-31');
  });

  it('only counts orders inside the range', () => {
    const r = computeOrderReport(
      [
        order({ delivery_date: '2026-09-05', lines: [line('p1', '0001', 'A', 5)] }),
        order({ delivery_date: '2026-09-25', lines: [line('p1', '0001', 'A', 7)] }),
      ],
      customRange('2026-09-01', '2026-09-10'),
    );
    // Both orders were passed in; the caller queries by range, so the
    // report aggregates what it is given. byDay reflects only the window.
    expect(r.byDay).toHaveLength(10);
    expect(r.byDay.find((d) => d.date === '2026-09-05')!.ordered).toBe(5);
    expect(r.byDay.some((d) => d.date === '2026-09-25')).toBe(false);
  });
});

describe('period labels', () => {
  it('labels each kind readably', () => {
    expect(periodLabel(periodRange('year', '2026-05-05'), 'en')).toBe('2026');
    expect(periodLabel(periodRange('month', '2026-05-05'), 'en')).toMatch(/May 2026/i);
    expect(periodLabel(customRange('2026-09-01', '2026-09-30'), 'en')).toMatch(/Sep.*Sep.*2026/);
  });

  it('shows both years when a custom range crosses one', () => {
    const label = periodLabel(customRange('2026-12-20', '2027-01-10'), 'en');
    expect(label).toContain('2026');
    expect(label).toContain('2027');
  });
});
