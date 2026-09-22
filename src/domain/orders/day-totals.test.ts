import { describe, it, expect } from 'vitest';
import { dayTotals } from './day-totals';
import type { Order } from '@/types/orders';

/** Only what the totals read; cast because the full Order shape adds nothing here. */
const order = (
  id: string,
  over: { delivery_date?: string; preparation_date?: string; status?: string },
  lines: [productId: string, name: string, qty: number | string][],
) =>
  ({
    id,
    status: over.status ?? 'confirmed',
    delivery_date: over.delivery_date ?? '2026-09-22',
    preparation_date: over.preparation_date ?? '2026-09-21',
    lines: lines.map(([productId, name, qty]) => ({
      product_id: productId,
      ordered_quantity: qty,
      product: { code: productId.toUpperCase(), name, family: name, presentation: '—' },
    })),
  }) as unknown as Order;

describe('day totals', () => {
  it('adds each product up across the day, counting the orders that carry it', () => {
    const totals = dayTotals(
      [
        order('o1', {}, [['p1', 'Tortilla 1kg', 3], ['p2', 'Totopos 500g', 2]]),
        order('o2', {}, [['p1', 'Tortilla 1kg', '1.5']]),
      ],
      '2026-09-22',
      'delivery_date',
    );
    expect(totals).toEqual([
      { productId: 'p1', code: 'P1', name: 'Tortilla 1kg', quantity: 4.5, orders: 2 },
      { productId: 'p2', code: 'P2', name: 'Totopos 500g', quantity: 2, orders: 1 },
    ]);
  });

  it('keeps only the day, on the chosen date', () => {
    const orders = [
      order('o1', { delivery_date: '2026-09-22', preparation_date: '2026-09-21' }, [['p1', 'A', 1]]),
      order('o2', { delivery_date: '2026-09-23', preparation_date: '2026-09-22' }, [['p1', 'A', 5]]),
    ];
    expect(dayTotals(orders, '2026-09-22', 'delivery_date')[0].quantity).toBe(1);
    expect(dayTotals(orders, '2026-09-22', 'preparation_date')[0].quantity).toBe(5);
  });

  it('counts an order once even when it appears in two lists, and skips cancelled ones', () => {
    const o1 = order('o1', {}, [['p1', 'A', 2]]);
    const totals = dayTotals(
      [o1, o1, order('o2', { status: 'cancelled' }, [['p1', 'A', 9]])],
      '2026-09-22',
      'delivery_date',
    );
    expect(totals).toEqual([{ productId: 'p1', code: 'P1', name: 'A', quantity: 2, orders: 1 }]);
  });

  it('counts an order once for a product listed on two of its lines', () => {
    const totals = dayTotals([order('o1', {}, [['p1', 'A', 2], ['p1', 'A', 3]])], '2026-09-22', 'delivery_date');
    expect(totals[0]).toMatchObject({ quantity: 5, orders: 1 });
  });
});
