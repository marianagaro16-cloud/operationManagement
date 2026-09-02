'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { lineProgress, canAllocate, toQuantity } from '@/domain/orders/progress';
import { weekDays } from '@/domain/orders/scheduling';
import { addDays } from '@/lib/datetime';
import { productLabel, type Order, type OrderLine } from '@/types/orders';
import { saveLotAllocation, deleteLotAllocation, setShortfallReason } from '@/server/order-actions';

/**
 * Lotnummerkontrol.
 *
 * Driven by PREPARATION date, grouped customer -> products. The person
 * preparing never re-enters customer, product or ordered quantity — those
 * come from the order. They enter only lot number, quantity and an optional
 * note, which is the entire point of the module.
 */
export function PreparationView({
  orders,
  date,
  isAdmin,
}: {
  orders: Order[];
  date: string;
  isAdmin: boolean;
}) {
  const { t, formatDate } = useI18n();

  // Several orders may exist for one customer on one day; they stay separate
  // records and are only grouped visually.
  const byCustomer = new Map<string, Order[]>();
  for (const o of orders) {
    const list = byCustomer.get(o.customer.name);
    if (list) list.push(o);
    else byCustomer.set(o.customer.name, [o]);
  }

  const days = weekDays(date);

  return (
    <>
      <PageHeader title={t('prep.title')} subtitle={t('prep.subtitle')} />

      {/* Weekday quick-navigation over real dates, never weekday entities. */}
      <div className="mb-4 flex items-center gap-1.5">
        <Link
          href={`/preparation?date=${addDays(date, -7)}`}
          aria-label={t('calendar.prev')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>

        <div className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1">
          {days.map((d) => (
            <Link
              key={d}
              href={`/preparation?date=${d}`}
              className={cn(
                'flex min-w-[52px] flex-1 flex-col items-center rounded-lg border px-1.5 py-1.5 text-center transition-colors',
                d === date
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-surface text-muted hover:text-fg',
              )}
            >
              <span className="text-[10.5px] font-medium uppercase">
                {formatDate(d, 'weekday').split(' ')[0].slice(0, 3)}
              </span>
              <span className="text-[13px] font-semibold tabular">{d.slice(8)}</span>
            </Link>
          ))}
        </div>

        <Link
          href={`/preparation?date=${addDays(date, 7)}`}
          aria-label={t('calendar.next')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <p className="mb-4 text-[13px] font-medium capitalize">{formatDate(date, 'weekday')}</p>

      {orders.length === 0 ? (
        <EmptyState title={t('prep.noWork')} body={t('prep.noWorkBody')} />
      ) : (
        <div className="space-y-6">
          {[...byCustomer.entries()].map(([customerName, customerOrders]) => (
            <section key={customerName}>
              <h2 className="mb-2 text-[15px] font-semibold">{customerName}</h2>
              <div className="space-y-3">
                {customerOrders.map((order) => (
                  <OrderPreparationCard key={order.id} order={order} isAdmin={isAdmin} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function OrderPreparationCard({ order, isAdmin }: { order: Order; isAdmin: boolean }) {
  const { t, formatDate } = useI18n();

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium tabular text-muted">#{order.reference}</span>
          {order.delivery_method && (
            <Badge tone="neutral">{order.delivery_method.name}</Badge>
          )}
          {order.order_type === 'sample' && <Badge tone="accent">{t('orders.typeSample')}</Badge>}
          {order.status === 'draft' && <Badge tone="warn">{t('orders.statusDraft')}</Badge>}
        </div>
        <span className="text-[12px] text-muted">
          {t('orders.deliveryOn', { date: formatDate(order.delivery_date, 'short') })}
        </span>
      </div>

      {/* Order-level note is shown once, never repeated per product. */}
      {order.note && (
        <p className="border-b border-border bg-surface-2/50 px-3.5 py-2 text-[12.5px] text-muted">
          {order.note}
        </p>
      )}

      <ul className="divide-y divide-border">
        {order.lines.map((line) => (
          <PreparationLine key={line.id} line={line} isAdmin={isAdmin} />
        ))}
      </ul>
    </Card>
  );
}

function PreparationLine({ line, isAdmin }: { line: OrderLine; isAdmin: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [lot, setLot] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState(line.shortfall_reason ?? '');
  const [error, setError] = useState<string | null>(null);

  const progress = lineProgress(line.ordered_quantity, line.allocations, line.shortfall_reason);

  const tone =
    progress.status === 'complete' ? 'done'
      : progress.status === 'over_allocated' ? 'late'
        : progress.status === 'partial' ? 'warn'
          : 'neutral';

  const statusLabel =
    progress.status === 'complete' ? t('prep.statusComplete')
      : progress.status === 'over_allocated' ? t('prep.statusOver')
        : progress.status === 'partial' ? t('prep.statusPartial')
          : t('prep.statusNotPrepared');

  function submitLot() {
    setError(null);
    const quantity = toQuantity(qty);

    // Mirrors the database trigger so the user gets an immediate, specific
    // message; the trigger is still what enforces it.
    const check = canAllocate(line.ordered_quantity, line.allocations, quantity, isAdmin);
    if (!check.ok) {
      setError(
        check.reason === 'over_allocation'
          ? t('prep.overAllocationBlocked', { available: check.available })
          : t('prep.lotQuantity'),
      );
      return;
    }
    if (!lot.trim()) { setError(t('prep.lotNumber')); return; }

    startTransition(async () => {
      const res = await saveLotAllocation({
        order_line_id: line.id,
        lot_number: lot.trim(),
        quantity,
        note: note.trim() || null,
      });
      if (!res.ok) {
        setError(res.error === 'over_allocation'
          ? t('prep.overAllocationBlocked', { available: progress.remaining })
          : res.error);
        return;
      }
      setLot(''); setQty(''); setNote(''); setAdding(false);
      router.refresh();
    });
  }

  function submitReason() {
    if (!reason.trim()) return;
    startTransition(async () => {
      const res = await setShortfallReason(line.id, reason);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <li className="px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium leading-snug">{productLabel(line.product)}</p>
          {line.product.code && (
            <span className="text-[11px] tabular text-subtle">{line.product.code}</span>
          )}
        </div>
        <Badge tone={tone}>
          {progress.status === 'complete' && <Check className="h-2.5 w-2.5" aria-hidden />}
          {statusLabel}
        </Badge>
      </div>

      {/* Ordered / allocated / remaining, always visible. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12.5px]">
        <span className="text-muted">
          {t('orders.ordered')}: <span className="font-medium tabular text-fg">{progress.ordered}</span>
        </span>
        <span className="text-muted">
          {t('orders.allocated')}: <span className="font-medium tabular text-fg">{progress.allocated}</span>
        </span>
        {progress.remaining > 0 && (
          <span className="text-warn">
            {t('orders.remaining')}: <span className="font-medium tabular">{progress.remaining}</span>
          </span>
        )}
        {progress.overBy > 0 && (
          <span className="text-late">
            {t('orders.over')}: <span className="font-medium tabular">{progress.overBy}</span>
          </span>
        )}
      </div>

      {line.allocations.length > 0 && (
        <ul className="mt-2 space-y-1">
          {line.allocations.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-md bg-surface-2/60 px-2 py-1 text-[12.5px]"
            >
              <span className="font-medium tabular">{a.lot_number}</span>
              <span className="tabular text-muted">× {toQuantity(a.quantity)}</span>
              {a.note && <span className="min-w-0 flex-1 truncate text-subtle">{a.note}</span>}
              <button
                onClick={() =>
                  startTransition(async () => {
                    await deleteLotAllocation(a.id);
                    router.refresh();
                  })
                }
                disabled={pending}
                aria-label={t('prep.deleteLot')}
                className="ml-auto shrink-0 text-subtle transition-colors hover:text-late"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="mt-2"><ErrorState message={error} /></div>}

      {/* Touch-friendly lot entry: three fields, one button. */}
      {adding ? (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface-2/40 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('prep.lotNumber')} htmlFor={`lot-${line.id}`} required>
              <Input
                id={`lot-${line.id}`}
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                inputMode="numeric"
                autoFocus
              />
            </Field>
            <Field label={t('prep.lotQuantity')} htmlFor={`qty-${line.id}`} required>
              <Input
                id={`qty-${line.id}`}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                type="number"
                min="0"
                step="any"
              />
            </Field>
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('prep.lotNotePlaceholder')}
            rows={1}
            className="min-h-[38px] text-[13px]"
            aria-label={t('prep.lotNote')}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={submitLot} loading={pending}>
              {t('prep.saveLot')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        progress.status !== 'complete' && (
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('prep.addLot')}
          </Button>
        )
      )}

      {/* A shortfall may not be left silent. */}
      {progress.needsReason && (
        <div className="mt-2 rounded-lg border border-warn/30 bg-warn/[0.06] p-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-warn">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t('prep.shortfallRequired')}
          </p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('prep.shortfallPlaceholder')}
            rows={1}
            className="min-h-[38px] text-[13px]"
            aria-label={t('prep.shortfallReason')}
          />
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={submitReason}
            loading={pending}
            disabled={!reason.trim()}
          >
            {t('prep.saveReason')}
          </Button>
        </div>
      )}

      {line.shortfall_reason && !progress.needsReason && progress.status === 'partial' && (
        <p className="mt-2 rounded-md bg-surface-2 px-2 py-1 text-[12px] text-muted">
          <span className="font-medium">{t('prep.shortfallReason')}:</span> {line.shortfall_reason}
        </p>
      )}
    </li>
  );
}
