'use client';

import { Weight } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { formatKg, orderWeight } from '@/domain/orders/weight';
import type { OrderLine } from '@/types/orders';

/**
 * Gross weight of an order (packaging included) on its ordered quantities.
 *
 * A partial total is still shown when some products have no weight yet, with
 * how many were left out beside it — never a number that pretends to be whole.
 */
export function OrderWeight({
  lines,
  icon = false,
  className,
}: {
  lines: Pick<OrderLine, 'ordered_quantity' | 'product'>[];
  icon?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const weight = orderWeight(lines, 'gross');
  return (
    <span className={cn('inline-flex items-center gap-1 tabular', className)}>
      {icon && <Weight className="h-3 w-3 shrink-0" aria-hidden />}
      <span title={t('orders.totalWeight')}>{formatKg(weight.kg)}</span>
      {weight.linesWithoutWeight > 0 && (
        <span className="text-warn" title={t('orders.withoutWeightHint')}>
          · {t('orders.withoutWeight', { count: weight.linesWithoutWeight })}
        </span>
      )}
    </span>
  );
}
