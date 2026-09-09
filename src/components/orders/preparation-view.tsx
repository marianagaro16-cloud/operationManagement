'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shell/app-shell';
import { canAllocate, lineProgress, toQuantity } from '@/domain/orders/progress';
import { groupLinesByBrand } from '@/domain/orders/picking';
import { weekDays } from '@/domain/orders/scheduling';
import { addDays } from '@/lib/datetime';
import { UrgencyBadge } from './urgency-badge';
import { NoteBlock, NoteChip } from '@/components/ui/note';
import { productLabel, type OrderLine, type OrderWithProgress } from '@/types/orders';
import { StatusChip, statusPresentation } from '@/components/ui/status-chip';
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
  carriedOver,
  openDays,
  date,
  canManage,
}: {
  orders: OrderWithProgress[];
  /** Unfinished work from earlier days. See getPreparationDay(). */
  carriedOver: OrderWithProgress[];
  /** Days in this week that still hold unfinished orders. */
  openDays: string[];
  date: string;
  canManage: boolean;
}) {
  const { t, formatDate } = useI18n();

  // Several orders may exist for one customer on one day; they stay separate
  // records and are only grouped visually.
  const byCustomer = new Map<string, OrderWithProgress[]>();
  for (const o of orders) {
    const list = byCustomer.get(o.customer.name);
    if (list) list.push(o);
    else byCustomer.set(o.customer.name, [o]);
  }

  const days = weekDays(date);
  const openDaySet = new Set(openDays);

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
              {/* A day with unfinished work says so. Without this the strip is
                  seven bare numbers and the only way to find open work is to
                  open each day in turn. */}
              <span
                className={cn(
                  'mt-0.5 h-1 w-1 rounded-full',
                  openDaySet.has(d) ? 'bg-warn' : 'bg-transparent',
                )}
                aria-hidden
              />
              {openDaySet.has(d) && <span className="sr-only">{t('prep.openWork')}</span>}
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

      {/* ------------------------- carried over ------------------------- */}
      {/* Above the day's own work: something already late outranks something
          merely due. Each card names the day it was scheduled for, so this
          never reads as duplicated work. */}
      {carriedOver.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.06] px-3.5 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">
                {t('prep.carriedOver')}
                <span className="ml-1.5 tabular text-warn">{carriedOver.length}</span>
              </p>
              <p className="text-[12.5px] text-muted">{t('prep.carriedOverBody')}</p>
            </div>
          </div>
          <div className="space-y-3">
            {carriedOver.map((order) => (
              <div key={order.id}>
                <h3 className="mb-1 text-[13.5px] font-medium">
                  {order.customer.name}
                  <span className="ml-2 text-[12px] font-normal text-warn">
                    {t('orders.preparationOn', {
                      date: formatDate(order.preparation_date, 'short'),
                    })}
                  </span>
                </h3>
                <OrderPreparationCard order={order} canManage={canManage} />
              </div>
            ))}
          </div>
        </section>
      )}

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
                  <OrderPreparationCard key={order.id} order={order} canManage={canManage} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function OrderPreparationCard({ order, canManage }: { order: OrderWithProgress; canManage: boolean }) {
  const { t, formatDate } = useI18n();
  // Computed once by the query layer; see OrderWithProgress.
  const progress = order.progress;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2">
        <div className="flex items-center gap-2">
          {/* The order this preparation belongs to, one tap away. */}
          <Link
            href={`/orders/${order.id}`}
            className="text-[12px] font-medium tabular text-muted transition-colors hover:text-accent hover:underline"
            title={t('orders.openOrder')}
          >
            #{order.reference}
          </Link>
          {order.delivery_method && (
            <Badge tone="neutral">{order.delivery_method.name}</Badge>
          )}
          {order.order_type === 'sample' && <Badge tone="accent">{t('orders.typeSample')}</Badge>}
          {/* A replacement is not a sale. Saying so on the row is what stops
              a month of apologies reading as a month of trade. */}
          {order.order_type === 'replacement' && (
            <Badge tone="warn">{t('orders.typeReplacement')}</Badge>
          )}
          {order.status !== 'confirmed' && <StatusChip domain="order" status={order.status} />}
        </div>
        <div className="flex items-center gap-2">
          <UrgencyBadge
            deliveryDate={order.delivery_date}
            deliveryTime={order.delivery_time}
            isComplete={progress.isComplete}
          />
          <span className="text-[12px] text-muted">
            {t('orders.deliveryOn', { date: formatDate(order.delivery_date, 'short') })}
          </span>
        </div>
      </div>

      {/* Order-level note is shown once, never repeated per product. */}
      {order.note && (
        <NoteBlock className="border-b border-border px-3.5 py-2">{order.note}</NoteBlock>
      )}

      {/* Grouped by brand, because our own brands are stocked together and
          the line order is otherwise whatever sequence somebody typed. The
          heading shows even when an order is all one brand: a picker reads
          one layout rather than two, and knowing the shelf before starting
          is worth a single line. Quantities and positions are untouched. */}
      {groupLinesByBrand(order.lines).map((group) => (
        <div key={group.brandId ?? '__none__'}>
          <p className="border-b border-border bg-surface-2/40 px-3.5 py-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
            {group.name ?? t('master.noBrand')}
          </p>
          <ul className="divide-y divide-border">
            {group.lines.map((line) => (
              <PreparationLine key={line.id} line={line} canManage={canManage} />
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

function PreparationLine({ line, canManage }: { line: OrderLine; canManage: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [lot, setLot] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState(line.shortfall_reason ?? '');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = lineProgress(line.ordered_quantity, line.allocations, line.shortfall_reason);

  // Both the label and the colour come from the one registry, instead of two
  // parallel four-branch ladders that had to be kept in step by hand.
  const presentation = statusPresentation('line', progress.status);
  const tone = presentation?.tone ?? 'neutral';
  const statusLabel = presentation ? t(presentation.key) : '';

  function submitLot() {
    setError(null);
    const quantity = toQuantity(qty);

    // Mirrors the database trigger so the user gets an immediate, specific
    // message; the trigger is still what enforces it.
    const check = canAllocate(line.ordered_quantity, line.allocations, quantity, canManage);
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
              {a.note && (
                <NoteChip className="min-w-0 flex-1 truncate">{a.note}</NoteChip>
              )}
              {/* Confirmed. This fired on the first tap of a small icon, on a
                  touchscreen, next to a scrolling list, and erased a recorded
                  lot with no undo — while the confirmation text for it sat
                  translated in all three dictionaries, unused. */}
              <button
                onClick={() => setDeleting(a.id)}
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

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const id = deleting;
          setDeleting(null);
          if (!id) return;
          startTransition(async () => {
            await deleteLotAllocation(id);
            router.refresh();
          });
        }}
        title={t('prep.deleteLot')}
        message={t('prep.deleteLotConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
    </li>
  );
}
