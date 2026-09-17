'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, PackageCheck, RotateCcw, Truck } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn, displayName } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';
import { orderStage } from '@/domain/orders/stage';
import { boxCount } from '@/domain/orders/weight';
import { setOrderReady, setOrdersShipped } from '@/server/order-actions';
import type { OrderWithProgress } from '@/types/orders';

/** The one chip that says where an order is: to prepare → … → shipped. */
export function OrderStageChip({ order, hideToPrepare = true }: { order: OrderWithProgress; hideToPrepare?: boolean }) {
  const stage = orderStage(order);
  // "To prepare" is the default state of every confirmed order; a chip on
  // every card saying so would be noise, not information.
  if (hideToPrepare && stage === 'to_prepare') return null;
  return <StatusChip domain="stage" status={stage} />;
}

const ERROR_KEY: Record<string, MessageKey> = {
  order_not_prepared: 'orders.errNotPrepared',
  order_not_confirmed: 'orders.errNotConfirmed',
  order_already_shipped: 'orders.errAlreadyShipped',
  order_not_ready: 'orders.errNotReady',
  order_ready_locked: 'orders.errReadyLocked',
  order_shipped_locked: 'orders.errShippedLocked',
  not_authorized: 'orders.errFulfilmentNotAuthorized',
  order_needs_boxes: 'orders.errNeedsBoxes',
  box_type_inactive: 'orders.errBoxTypeInactive',
};

export function useOrderError() {
  const { t } = useI18n();
  return (code: string) => (ERROR_KEY[code] ? t(ERROR_KEY[code]) : t('common.error'));
}

/**
 * Ready and Shipped, on one order.
 *
 * Marked by whoever prepares — the same people who record lots. Each step
 * shows who did it and when, and can be reopened: Shipped back to Ready,
 * Ready back to preparation.
 *
 * Mark ready is offered only once every product is accounted for (fully
 * recorded, or short with a reason); before that the button is there but
 * disabled, and says what is missing, so nobody wonders where it went.
 */
export function OrderFulfilment({
  order,
  className,
  boxesRequired = false,
  boxesOnThisScreen = true,
}: {
  order: OrderWithProgress;
  className?: string;
  /** Ready needs at least one box — true once box types exist. */
  boxesRequired?: boolean;
  /** False on the order's own page, where boxes are not recorded: the hint then says where they are. */
  boxesOnThisScreen?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const translate = useOrderError();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (order.status !== 'confirmed') return null;

  const stamp = (iso: string) => {
    const dt = DateTime.fromISO(iso).setZone(BUSINESS_TZ).setLocale(locale);
    return dt.hasSame(DateTime.now().setZone(BUSINESS_TZ), 'day') ? dt.toFormat('HH:mm') : dt.toFormat('d LLL, HH:mm');
  };

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) { setError(translate(res.error ?? '')); return; }
      router.refresh();
    });
  }

  const ready = Boolean(order.ready_at);
  const shipped = Boolean(order.shipped_at);
  const needsBoxes = boxesRequired && boxCount(order.boxes) === 0;
  const readyHint = !order.progress.isPrepared
    ? t('orders.readyNeedsPrepared')
    : needsBoxes
      ? t(boxesOnThisScreen ? 'orders.readyNeedsBoxes' : 'orders.readyNeedsBoxesElsewhere')
      : null;

  return (
    <div className={cn('space-y-1.5', className)}>
      {(ready || shipped) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
          {ready && order.ready_at && (
            <span className="inline-flex items-center gap-1 text-done">
              <PackageCheck className="h-3.5 w-3.5" aria-hidden />
              {t('orders.readyBy', {
                name: order.ready_by_profile ? displayName(order.ready_by_profile) : '—',
                time: stamp(order.ready_at),
              })}
            </span>
          )}
          {shipped && order.shipped_at && (
            <span className="inline-flex items-center gap-1 text-muted">
              <Truck className="h-3.5 w-3.5" aria-hidden />
              {t('orders.shippedBy', {
                name: order.shipped_by_profile ? displayName(order.shipped_by_profile) : '—',
                time: stamp(order.shipped_at),
              })}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {!ready && (
          <>
            <Button
              size="sm"
              variant="success"
              onClick={() => run(() => setOrderReady(order.id, true))}
              loading={pending}
              disabled={readyHint !== null}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              {t('orders.markReady')}
            </Button>
            {readyHint && <span className="text-[11.5px] text-subtle">{readyHint}</span>}
          </>
        )}

        {ready && !shipped && (
          <>
            <Button size="sm" variant="primary" onClick={() => run(() => setOrdersShipped([order.id], true))} loading={pending}>
              <Truck className="h-3.5 w-3.5" aria-hidden />
              {t('orders.markShipped')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run(() => setOrderReady(order.id, false))} disabled={pending}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t('orders.reopen')}
            </Button>
          </>
        )}

        {shipped && (
          <Button size="sm" variant="ghost" onClick={() => run(() => setOrdersShipped([order.id], false))} loading={pending}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t('orders.reopen')}
          </Button>
        )}
      </div>

      {error && <p className="text-[12px] text-late">{error}</p>}
    </div>
  );
}
