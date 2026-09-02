'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { orderProgress } from '@/domain/orders/progress';
import { compareUrgency, deliveryUrgency, formatDeliveryTime } from '@/domain/orders/urgency';
import { countdownLabel } from './urgency-badge';
import type { Order } from '@/types/orders';

/**
 * The in-app alert.
 *
 * Lists orders whose delivery deadline is close (or passed) and which are NOT
 * finished. Completed work never appears here — an alert that fires on things
 * already done is an alert people learn to ignore.
 *
 * Recomputed every minute so it becomes more urgent on its own, without the
 * operator refreshing the page.
 */
export function UrgentAlert({ orders }: { orders: Order[] }) {
  const { t } = useI18n();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const current = now ?? new Date();

  const alerts = orders
    .map((order) => {
      const progress = orderProgress(
        order.lines.map((l) => ({
          ordered_quantity: l.ordered_quantity,
          shortfall_reason: l.shortfall_reason,
          allocations: l.allocations,
        })),
      );
      return {
        order,
        progress,
        urgency: deliveryUrgency(
          order.delivery_date,
          order.delivery_time,
          progress.isComplete,
          current,
        ),
      };
    })
    .filter((a) => a.urgency.isAlert)
    .sort((a, b) => compareUrgency(a.urgency, b.urgency));

  if (alerts.length === 0) return null;

  // The worst level sets the banner's colour.
  const worst = alerts[0].urgency.level;
  const critical = worst === 'overdue' || worst === 'critical';

  return (
    <section
      role="alert"
      className={cn(
        'mb-4 rounded-xl border p-3.5',
        critical ? 'border-late/40 bg-late/[0.07]' : 'border-warn/30 bg-warn/[0.07]',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            critical ? 'bg-late/15 text-late' : 'bg-warn/15 text-warn',
          )}
        >
          <TriangleAlert className="h-4 w-4" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug">
            {alerts.length === 1
              ? t('urgency.alertTitleOne')
              : t('urgency.alertTitle', { count: alerts.length })}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted">{t('urgency.alertBody')}</p>

          <ul className="mt-2 space-y-1">
            {alerts.slice(0, 5).map(({ order, progress, urgency }) => {
              const time = formatDeliveryTime(order.delivery_time);
              const open = progress.lines - progress.complete;
              return (
                <li key={order.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                  <span className="font-medium">{order.customer.name}</span>
                  <span className="tabular text-subtle">#{order.reference}</span>
                  {time && <span className="tabular text-muted">{t('urgency.byTime', { time })}</span>}
                  <span
                    className={cn(
                      'font-medium tabular',
                      urgency.level === 'overdue' || urgency.level === 'critical'
                        ? 'text-late'
                        : 'text-warn',
                    )}
                  >
                    {countdownLabel(urgency, t as never)}
                  </span>
                  <span className="text-subtle">· {t('urgency.stillOpen', { count: open })}</span>
                </li>
              );
            })}
          </ul>

          {alerts.length > 5 && (
            <p className="mt-1 text-[12px] text-subtle">+{alerts.length - 5}</p>
          )}

          <Link
            href="/preparation"
            className={cn(
              'mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium',
              critical ? 'text-late' : 'text-warn',
            )}
          >
            {t('urgency.viewOrders')}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
