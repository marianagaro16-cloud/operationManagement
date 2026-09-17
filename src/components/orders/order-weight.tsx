'use client';

import { Package, Weight } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { boxCount, boxesWeightKg, formatKg, orderWeight, roundKg } from '@/domain/orders/weight';
import type { Order } from '@/types/orders';

/**
 * Gross weight of an order: its products on their ordered quantities, plus
 * the empty weight of the boxes it is packed in.
 *
 * A partial total is still shown when some products have no weight yet, with
 * how many were left out beside it — never a number that pretends to be whole.
 *
 * `showBoxes` adds the box count (order cards). `breakdown` adds what the
 * total is made of (the order's own page).
 */
export function OrderWeight({
  order,
  icon = false,
  showBoxes = false,
  breakdown = false,
  className,
}: {
  order: Pick<Order, 'lines' | 'boxes'>;
  icon?: boolean;
  showBoxes?: boolean;
  breakdown?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const products = orderWeight(order.lines, 'gross');
  const boxesKg = boxesWeightKg(order.boxes);
  const boxes = boxCount(order.boxes);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-1 tabular', className)}>
      {icon && <Weight className="h-3 w-3 shrink-0" aria-hidden />}
      <span title={t('orders.totalWeight')}>{formatKg(roundKg(products.kg + boxesKg))}</span>
      {products.linesWithoutWeight > 0 && (
        <span className="text-warn" title={t('orders.withoutWeightHint')}>
          · {t('orders.withoutWeight', { count: products.linesWithoutWeight })}
        </span>
      )}
      {showBoxes && boxes > 0 && (
        <span className="inline-flex items-center gap-1">
          ·{icon && <Package className="h-3 w-3 shrink-0" aria-hidden />}
          {boxes === 1 ? t('orders.boxCountOne') : t('orders.boxCount', { count: boxes })}
        </span>
      )}
      {breakdown && boxes > 0 && (
        <span className="basis-full text-[12px] font-normal text-muted">
          {t('orders.weightBreakdown', { products: formatKg(products.kg), boxes: formatKg(boxesKg) })}
        </span>
      )}
    </span>
  );
}
