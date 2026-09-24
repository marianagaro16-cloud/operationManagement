import { describe, it, expect } from 'vitest';
import {
  computeOrderReport,
  narrowToBrand,
  narrowToProduct,
  periodRange,
  shiftPeriod,
  productReportToCsv,
  renameClassification,
  customRange,
  shiftCustomRange,
  periodLabel,
  MAX_CUSTOM_DAYS,
  type ReportPeriod,
} from './reporting';
import { localizedName, type Order } from '@/types/orders';

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

/**
 * The same line with a brand hung off its product, which is where the report
 * reads it from — the aggregation never sees the brands table itself.
 */
const branded = (
  l: NonNullable<Order['lines']>[number],
  brandId: string | null,
  name: string | null,
) =>
  ({
    ...l,
    product: {
      ...(l as unknown as { product: Record<string, unknown> }).product,
      brand_id: brandId,
      brand: brandId ? { id: brandId, name, sort_order: 10, is_active: true } : null,
    },
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

  it('weighs the units ordered on the same lines, and counts products it could not weigh', () => {
    const weighed = (l: NonNullable<Order['lines']>[number], kg: number | string | null) =>
      ({ ...l, product: { ...l.product, net_weight_kg: kg } }) as NonNullable<Order['lines']>[number];
    const r = computeOrderReport(
      [
        order({ lines: [weighed(line('p1', '0001', 'Tortillas', 10), 1.75), weighed(line('p2', '0002', 'Salsa', 4), null)] }),
        order({ order_type: 'sample', lines: [weighed(line('p3', '0003', 'Mezcal', 2), '0.7'), weighed(line('p2', '0002', 'Salsa', 1), null)] }),
        order({ status: 'cancelled', lines: [weighed(line('p1', '0001', 'Tortillas', 99), 1.75)] }),
      ],
      SEP,
    );
    expect(r.totalWeightKg).toBe(18.9); // 10 × 1.75 + 2 × 0.7; the cancelled order is not weighed
    expect(r.productsWithoutWeight).toBe(1); // Salsa, on two orders
  });

  it('counts the boxes of counted orders, in total and per type', () => {
    const box = (id: string, name: string, quantity: number) => ({ box_type_id: id, quantity, box_type: { name } });
    const r = computeOrderReport(
      [
        order({ lines: [line('p1', '0001', 'Tortillas', 1)], boxes: [box('b1', 'Grande', 2), box('b2', 'Pequeña', 1)] } as never),
        order({ lines: [line('p1', '0001', 'Tortillas', 1)], boxes: [box('b2', 'Pequeña', 4)] } as never),
        order({ status: 'cancelled', lines: [line('p1', '0001', 'Tortillas', 1)], boxes: [box('b1', 'Grande', 9)] } as never),
      ],
      SEP,
    );
    expect(r.totalBoxes).toBe(7);
    expect(r.byBoxType).toEqual([
      { boxTypeId: 'b2', name: 'Pequeña', boxes: 5 },
      { boxTypeId: 'b1', name: 'Grande', boxes: 2 },
    ]);
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

  it('counts replacements apart from sales', () => {
    // A month's ORDERS and a month's TRADE are different numbers once some of
    // those orders were sent to apologise. Folding replacements into sales
    // overstates the second by exactly the cost of the first.
    const r = computeOrderReport(
      [
        order({ lines: [line('p1', '0001', 'T', 10)] }),
        order({ order_type: 'replacement', lines: [line('p1', '0001', 'T', 2)] }),
        order({ order_type: 'sample', lines: [line('p1', '0001', 'T', 1)] }),
      ],
      SEP,
    );
    expect(r.orders).toBe(3);
    expect(r.replacements).toBe(1);
    expect(r.samples).toBe(1);
    // Every order still contributes its quantity: the split is about what the
    // delivery WAS, not about whether it happened.
    expect(r.totalOrdered).toBe(13);
  });

  it('reports no replacements when there are none', () => {
    const r = computeOrderReport([order({ lines: [line('p1', '0001', 'T', 1)] })], SEP);
    expect(r.replacements).toBe(0);
  });

  it('counts sponsorships apart from both sales and samples', () => {
    // A sponsorship is not a sale — nobody pays for it — and it is not a
    // sample either: no future order is expected of the recipient, so folding
    // it into samples would answer "did they buy" with a permanent no and
    // make every sample cohort look worse than it was.
    const r = computeOrderReport(
      [
        order({ lines: [line('p1', '0001', 'T', 10)] }),
        order({ order_type: 'sponsorship', lines: [line('p1', '0001', 'T', 4)] }),
        order({ order_type: 'sample', lines: [line('p1', '0001', 'T', 1)] }),
      ],
      SEP,
    );
    expect(r.orders).toBe(3);
    expect(r.sponsorships).toBe(1);
    expect(r.samples).toBe(1);
    expect(r.replacements).toBe(0);
    // The crates left the warehouse either way.
    expect(r.totalOrdered).toBe(15);
  });

  it('reports no sponsorships when there are none', () => {
    const r = computeOrderReport([order({ lines: [line('p1', '0001', 'T', 1)] })], SEP);
    expect(r.sponsorships).toBe(0);
  });

  it('counts consignments apart from sales and from the free types', () => {
    // A consignment is not a sale yet — the crates sit on the customer's
    // shelf as ours and what does not sell comes back — and it is not a
    // giveaway either, so it belongs in neither pile.
    const r = computeOrderReport(
      [
        order({ lines: [line('p1', '0001', 'T', 10)] }),
        order({ order_type: 'consignment', lines: [line('p1', '0001', 'T', 6)] }),
        order({ order_type: 'sample', lines: [line('p1', '0001', 'T', 1)] }),
      ],
      SEP,
    );
    expect(r.orders).toBe(3);
    expect(r.consignments).toBe(1);
    expect(r.samples).toBe(1);
    expect(r.sponsorships).toBe(0);
    // They left the warehouse like any other crates, sold or not.
    expect(r.totalOrdered).toBe(17);
  });

  it('reports no consignments when there are none', () => {
    const r = computeOrderReport([order({ lines: [line('p1', '0001', 'T', 1)] })], SEP);
    expect(r.consignments).toBe(0);
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

describe('quantities per brand', () => {
  it('ranks brands by units ordered and counts distinct products', () => {
    const r = computeOrderReport(
      [
        order({
          lines: [
            branded(line('p1', '0001', 'A', 5), 'b1', 'Masamor'),
            branded(line('p2', '0002', 'B', 3), 'b1', 'Masamor'),
            branded(line('p3', '0003', 'C', 40), 'b2', 'Del Barrio'),
          ],
        }),
      ],
      SEP,
    );
    expect(r.byBrand.map((b) => b.name)).toEqual(['Del Barrio', 'Masamor']);
    expect(r.byBrand[0].ordered).toBe(40);
    expect(r.byBrand[0].products).toBe(1);
    expect(r.byBrand[1].ordered).toBe(8);
    expect(r.byBrand[1].products).toBe(2);
    expect(r.byBrand[1].lines).toBe(2);
  });

  it('counts a product once however many orders and lines carry it', () => {
    const r = computeOrderReport(
      [
        order({ lines: [branded(line('p1', '0001', 'A', 5), 'b1', 'Masamor')] }),
        order({ lines: [branded(line('p1', '0001', 'A', 7), 'b1', 'Masamor')] }),
      ],
      SEP,
    );
    expect(r.byBrand).toHaveLength(1);
    expect(r.byBrand[0].products).toBe(1);
    expect(r.byBrand[0].lines).toBe(2);
    expect(r.byBrand[0].ordered).toBe(12);
  });

  it('accumulates prepared quantities alongside ordered ones', () => {
    const r = computeOrderReport(
      [order({ lines: [branded(line('p1', '0001', 'A', 10, [4, 2]), 'b1', 'Masamor')] })],
      SEP,
    );
    expect(r.byBrand[0].prepared).toBe(6);
  });

  // A breakdown that quietly drops volume is worse than one that shows a gap:
  // the brand rows have to add up to the period total, and how much is
  // unclassified is itself worth seeing.
  it('keeps unclassified products in one row so the totals still reconcile', () => {
    const r = computeOrderReport(
      [
        order({
          lines: [
            branded(line('p1', '0001', 'A', 5), 'b1', 'Masamor'),
            line('p2', '0002', 'B', 3),
            line('p3', '0003', 'C', 2),
          ],
        }),
      ],
      SEP,
    );
    const none = r.byBrand.find((b) => b.brandId === null)!;
    expect(none.name).toBeNull();
    expect(none.ordered).toBe(5);
    expect(none.products).toBe(2);
    expect(r.byBrand.reduce((sum, b) => sum + b.ordered, 0)).toBe(r.totalOrdered);
  });

  it('is empty for a period with no orders', () => {
    expect(computeOrderReport([], SEP).byBrand).toEqual([]);
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
      [order({ lines: [branded(line('p1', '0001', 'Tortillas 1kg', 10, [8]), 'b1', 'Masamor')] })],
      SEP,
    );
    const csv = productReportToCsv(r);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('category;subcategory;code;product;brand;ordered;prepared;missing;lines;customers');
    expect(rows[1]).toBe(';;0001;Tortillas 1kg;Masamor;10;8;2;1;1');
  });

  it('leaves the brand column empty rather than absent for an unclassified product', () => {
    const r = computeOrderReport(
      [order({ lines: [line('p1', '0001', 'Tortillas 1kg', 10, [8])] })],
      SEP,
    );
    const rows = productReportToCsv(r).split(String.fromCharCode(10));
    expect(rows[1]).toBe(';;0001;Tortillas 1kg;;10;8;2;1;1');
  });

  it('quotes a product name containing the separator', () => {
    const r = computeOrderReport(
      [order({ lines: [line('p1', '0001', 'Tortillas; grandes', 1)] })],
      SEP,
    );
    expect(productReportToCsv(r).split('\n')[1]).toContain('"Tortillas; grandes"');
  });
});

/* --------------------------- product grouping --------------------------- */

describe('product grouping', () => {
  const taxonomy = {
    categories: [
      { id: 'tort', name: 'Tortilla', name_es: null, name_de: null, sort_order: 10, is_active: true },
      { id: 'toto', name: 'Totopos', name_es: null, name_de: null, sort_order: 20, is_active: true },
    ],
    subcategories: [
      { id: 'd14', category_id: 'tort', name: 'Ø14 Gelb', name_es: null, name_de: null, sort_order: 100, is_active: true },
      { id: 'd6', category_id: 'tort', name: 'Ø6 Gelb', name_es: null, name_de: null, sort_order: 100, is_active: true },
      { id: 'blau', category_id: 'toto', name: 'Blau', name_es: null, name_de: null, sort_order: 100, is_active: true },
    ],
  };

  /** A line whose product is classified, where the report reads it from. */
  const classified = (
    l: NonNullable<Order['lines']>[number],
    categoryId: string | null,
    subcategoryId: string | null,
  ) =>
    ({
      ...l,
      product: {
        ...(l as unknown as { product: Record<string, unknown> }).product,
        category_id: categoryId,
        subcategory_id: subcategoryId,
      },
    }) as unknown as NonNullable<Order['lines']>[number];

  const orders = () => [
    order({
      customer_id: 'c1',
      lines: [
        classified(line('p1', '0001', 'Tortilla 0.5kg Ø14', 10, [10]), 'tort', 'd14'),
        classified(line('p2', '0002', 'Tortilla 1kg Ø14', 4, [2]), 'tort', 'd14'),
        classified(line('p3', '0003', 'Tortilla 1kg Ø6', 3, [3]), 'tort', 'd6'),
        classified(line('p4', '0004', 'Totopos Blau 1kg', 5, [5]), 'toto', 'blau'),
        line('p5', '0005', 'Salsa', 2, [2]),
      ],
    }),
    order({
      customer_id: 'c2',
      lines: [classified(line('p1', '0001', 'Tortilla 0.5kg Ø14', 6, [6]), 'tort', 'd14')],
    }),
  ];

  it('adds units up by subcategory, in taxonomy order with unclassified last', () => {
    const r = computeOrderReport(orders(), SEP, taxonomy);
    expect(r.bySubcategory.map((g) => [g.category, g.subcategory, g.ordered])).toEqual([
      // "Ø6" before "Ø14": names compare numerically.
      ['Tortilla', 'Ø6 Gelb', 3],
      ['Tortilla', 'Ø14 Gelb', 20],
      ['Totopos', 'Blau', 5],
      [null, null, 2],
    ]);
  });

  it('adds units up by category', () => {
    const r = computeOrderReport(orders(), SEP, taxonomy);
    expect(r.byCategory.map((g) => [g.category, g.ordered, g.products.length])).toEqual([
      ['Tortilla', 23, 3],
      ['Totopos', 5, 1],
      [null, 2, 1],
    ]);
  });

  it('counts distinct customers per group and sums what each product is missing', () => {
    const d14 = computeOrderReport(orders(), SEP, taxonomy).bySubcategory[1];
    expect(d14.customers).toBe(2);
    expect(d14.missing).toBe(2);
    expect(d14.lines).toBe(3);
    // Most sold first inside the group.
    expect(d14.products.map((p) => p.productId)).toEqual(['p1', 'p2']);
  });

  it('still adds up to the period total', () => {
    const r = computeOrderReport(orders(), SEP, taxonomy);
    const sum = (gs: { ordered: number }[]) => gs.reduce((n, g) => n + g.ordered, 0);
    expect(sum(r.byCategory)).toBe(r.totalOrdered);
    expect(sum(r.bySubcategory)).toBe(r.totalOrdered);
  });

  it('puts products with a category but no subcategory in their own group', () => {
    const r = computeOrderReport(
      [order({ lines: [classified(line('p1', '0001', 'Tortilla', 1), 'tort', null)] })],
      SEP,
      taxonomy,
    );
    expect(r.bySubcategory.map((g) => [g.category, g.subcategory])).toEqual([['Tortilla', null]]);
  });

  it('ignores a subcategory that belongs to another category', () => {
    const r = computeOrderReport(
      [order({ lines: [classified(line('p1', '0001', 'Tortilla', 1), 'tort', 'blau')] })],
      SEP,
      taxonomy,
    );
    expect(r.byProduct[0]).toMatchObject({ category: 'Tortilla', subcategory: null });
  });

  it('exports each group total followed by its products', () => {
    const r = computeOrderReport(orders(), SEP, taxonomy);
    const rows = productReportToCsv(r, 'category').split('\n');
    expect(rows[1]).toBe('Tortilla;;;;;23;21;2;4;2');
    expect(rows[2]).toBe('Tortilla;Ø14 Gelb;0001;Tortilla 0.5kg Ø14;;16;16;0;2;2');
  });

  it('renames categories into another language without reordering', () => {
    const names: Record<string, string> = { tort: 'Tortilla amarilla', d14: 'Ø14 amarilla' };
    const r = renameClassification(computeOrderReport(orders(), SEP, taxonomy), {
      category: (id) => names[id],
      subcategory: (id) => names[id],
    });
    // Ø6 has no translation here, so it keeps its name.
    expect(r.bySubcategory.map((g) => [g.category, g.subcategory])).toEqual([
      ['Tortilla amarilla', 'Ø6 Gelb'],
      ['Tortilla amarilla', 'Ø14 amarilla'],
      ['Totopos', 'Blau'],
      [null, null],
    ]);
    expect(r.bySubcategory[1].products[0]).toMatchObject({ category: 'Tortilla amarilla', subcategory: 'Ø14 amarilla' });
    expect(productReportToCsv(r, 'category').split('\n')[1]).toBe('Tortilla amarilla;;;;;23;21;2;4;2');
  });

  it("names a category in the viewer's language, English when untranslated", () => {
    const c = { name: 'Blue tortilla', name_es: 'Tortilla azul', name_de: null };
    expect(localizedName(c, 'es')).toBe('Tortilla azul');
    expect(localizedName(c, 'de')).toBe('Blue tortilla');
    expect(localizedName(c, 'en')).toBe('Blue tortilla');
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

describe('narrowToBrand', () => {
  const orders = [
    order({ lines: [branded(line('p1', '01', 'Chorizo', 4), 'b1', 'Del Barrio'), line('p2', '02', 'Queso', 7)] }),
    order({ lines: [branded(line('p3', '03', 'Tortilla', 3), 'b2', 'Masamor')] }),
  ];

  it('keeps only that brand\'s lines, and only the orders that carry it', () => {
    const report = computeOrderReport(narrowToBrand(orders, 'b1'), SEP);
    expect(report.orders).toBe(1);
    expect(report.totalOrdered).toBe(4);
    expect(report.byProduct.map((p) => p.productId)).toEqual(['p1']);
  });

  it("'none' keeps the unclassified products", () => {
    const report = computeOrderReport(narrowToBrand(orders, 'none'), SEP);
    expect(report.byProduct.map((p) => p.productId)).toEqual(['p2']);
    expect(report.totalOrdered).toBe(7);
  });
});

describe('narrowToProduct', () => {
  it('keeps only that product\'s lines, and only the orders that carry it', () => {
    const orders = [
      order({ lines: [line('p1', '01', 'Chorizo', 4, [4]), line('p2', '02', 'Queso', 7)] }),
      order({ lines: [line('p2', '02', 'Queso', 3)] }),
    ];
    const report = computeOrderReport(narrowToProduct(orders, 'p1'), SEP);
    expect(report.orders).toBe(1);
    expect(report.totalOrdered).toBe(4);
    expect(report.byProduct.map((p) => p.productId)).toEqual(['p1']);
    expect(report.fulfilmentRate).toBe(100);
  });
});
