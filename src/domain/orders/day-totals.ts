import { toQuantity } from './progress';
import { productLabel, type Order } from '@/types/orders';

/**
 * How much of each product one day's orders add up to.
 *
 * Pure, like the report next door. For the production manager, who needs
 * to know what the day needs without reading every order: units ordered per
 * product, in each product's own presentation — never summed across
 * products, for the same reason the report does not.
 */

export interface DayTotal {
  productId: string;
  code: string | null;
  name: string;
  /** Units ordered across the day's orders. */
  quantity: number;
  /** How many of the day's orders carry it. */
  orders: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Totals over the orders whose `dateKey` is `date`.
 *
 * The board's lists overlap (and Ready carries a backlog from earlier days),
 * so orders are de-duplicated by id and filtered to the day here rather than
 * trusted to arrive clean. Cancelled orders are not going anywhere and do
 * not count.
 */
export function dayTotals(
  orders: Order[],
  date: string,
  dateKey: 'delivery_date' | 'preparation_date',
): DayTotal[] {
  const seen = new Set<string>();
  const totals = new Map<string, DayTotal>();

  for (const order of orders) {
    if (seen.has(order.id) || order.status === 'cancelled' || order[dateKey] !== date) continue;
    seen.add(order.id);

    const onThisOrder = new Set<string>();
    for (const line of order.lines ?? []) {
      const total = totals.get(line.product_id) ?? {
        productId: line.product_id,
        code: line.product?.code ?? null,
        name: line.product ? productLabel(line.product) : '—',
        quantity: 0,
        orders: 0,
      };
      total.quantity = round3(total.quantity + toQuantity(line.ordered_quantity));
      if (!onThisOrder.has(line.product_id)) {
        total.orders++;
        onThisOrder.add(line.product_id);
      }
      totals.set(line.product_id, total);
    }
  }

  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
}
