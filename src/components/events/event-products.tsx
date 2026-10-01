'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PackageOpen, Pencil, Truck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { OrderLineEditor, emptyLine, type DraftLine } from '@/components/orders/order-line-editor';
import { toQuantity } from '@/domain/orders/progress';
import { BUSINESS_TZ } from '@/lib/datetime';
import { DateTime } from 'luxon';
import { productLabel, type DeliveryMethod, type Product } from '@/types/orders';
import { saveReturns, setEventDelivery, setEventProducts } from '@/server/event-actions';
import type { EventOrder, EventProduct, EventReturn, EventRow } from '@/types/events';
import { useEventLabels, useEventsReadOnly } from './event-parts';

/** The day it goes when nobody chose one: the day before the start. */
export function deliveryDateOf(event: EventRow, order: EventOrder | null): string {
  return (
    order?.delivery_date ??
    event.delivery_date ??
    DateTime.fromISO(event.start_date, { zone: BUSINESS_TZ }).minus({ days: 1 }).toISODate()!
  );
}

const num = (n: number) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 }).format(n);

/**
 * What we take: before confirming, the event's list; after, its order's
 * lines — changed here until Operations marks the order ready. After the
 * event: what came back, what was thrown away, and so what was used.
 */
export function EventProducts({
  event,
  order,
  products,
  returns,
  catalog,
  methods,
}: {
  event: EventRow;
  order: EventOrder | null;
  products: EventProduct[];
  returns: EventReturn[];
  catalog: Product[];
  methods: DeliveryMethod[];
}) {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [returning, setReturning] = useState(false);
  const live = event.stage === 'idea' || event.stage === 'confirmed';
  const liveOrder = order?.status === 'confirmed' ? order : null;
  const readOnly = useEventsReadOnly();
  const canEdit = !readOnly && live && !liveOrder?.ready_at;
  const canDeliver = !readOnly && live && !liveOrder?.shipped_at;
  // After the event, or once its goods have left: what came back.
  const afterwards = event.stage === 'done' || !!liveOrder?.shipped_at;
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const back = new Map(returns.map((r) => [r.product_id, r]));
  const methodId = liveOrder?.delivery_method_id ?? event.delivery_method_id;
  const methodName = methods.find((m) => m.id === methodId)?.name ?? '—';

  const orderState = !order
    ? null
    : order.status === 'cancelled'
      ? { label: t('orders.statusCancelled'), tone: 'skipped' as const }
      : order.shipped_at
        ? { label: t('event.orderShipped'), tone: 'done' as const }
        : order.ready_at
          ? { label: t('event.orderReady'), tone: 'accent' as const }
          : { label: t('event.orderPreparing'), tone: 'neutral' as const };

  return (
    <Card className="p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('event.products')}</h2>
        <div className="flex gap-1">
          {!readOnly && afterwards && products.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setReturning(true)}>
              <PackageOpen className="h-3.5 w-3.5" aria-hidden />
              {t('event.recordReturns')}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('common.edit')}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <span className="inline-flex items-center gap-1">
          <Truck className="h-3.5 w-3.5 text-muted" aria-hidden />
          <span className="tabular">{formatDate(deliveryDateOf(event, liveOrder), 'weekday')}</span>
          <span className="text-muted">· {methodName}</span>
          {canDeliver && (
            <Button size="icon" variant="ghost" aria-label={t('event.delivery')} onClick={() => setDelivering(true)}>
              <Pencil className="h-3 w-3" aria-hidden />
            </Button>
          )}
        </span>
        {order && orderState && (
          <span className="inline-flex items-center gap-1.5">
            <Link href={`/orders/${order.id}`} className="font-medium text-accent hover:underline">
              {t('event.orderRef', { reference: order.reference })}
            </Link>
            <Badge tone={orderState.tone}>{orderState.label}</Badge>
          </span>
        )}
      </div>

      {event.stage === 'idea' && <p className="mb-2 text-[12px] text-muted">{t('event.productsIdeaHint')}</p>}
      {live && liveOrder?.ready_at && <p className="mb-2 text-[12px] text-muted">{t('event.productsLocked')}</p>}

      {products.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t('event.productsNone')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-muted">
                <th className="py-1 font-medium">{t('event.product')}</th>
                <th className="py-1 pl-2 text-right font-medium">{t('event.taken')}</th>
                {afterwards && (
                  <>
                    <th className="py-1 pl-2 text-right font-medium">{t('event.cameBack')}</th>
                    <th className="py-1 pl-2 text-right font-medium">{t('event.thrownAway')}</th>
                    <th className="py-1 pl-2 text-right font-medium">{t('event.used')}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((l) => {
                const p = byId.get(l.product_id);
                const taken = l.prepared ?? l.quantity;
                const r = back.get(l.product_id);
                return (
                  <tr key={l.product_id}>
                    <td className="py-1.5 pr-2">
                      {p ? productLabel(p) : '—'}
                      {l.note && <span className="block text-[12px] text-muted">{l.note}</span>}
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular">
                      {num(taken)}
                      {l.prepared !== null && l.prepared !== l.quantity && (
                        <span className="block text-[11px] text-muted">{t('event.ofOrdered', { quantity: num(l.quantity) })}</span>
                      )}
                    </td>
                    {afterwards && (
                      <>
                        <td className="py-1.5 pl-2 text-right tabular">{r ? num(r.back_quantity) : '—'}</td>
                        <td className="py-1.5 pl-2 text-right tabular">{r ? num(r.discarded_quantity) : '—'}</td>
                        <td className="py-1.5 pl-2 text-right font-medium tabular">
                          {r ? num(Math.max(taken - r.back_quantity - r.discarded_quantity, 0)) : '—'}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProductsDialog event={event} products={products} catalog={catalog} hasOrder={!!liveOrder} onClose={() => setEditing(false)} />
      )}
      {delivering && (
        <DeliveryDialog
          event={event}
          date={deliveryDateOf(event, liveOrder)}
          methodId={methodId}
          methods={methods}
          onClose={() => setDelivering(false)}
        />
      )}
      {returning && (
        <ReturnsDialog event={event} products={products} returns={returns} catalog={catalog} onClose={() => setReturning(false)} />
      )}
    </Card>
  );
}

function ProductsDialog({
  event,
  products,
  catalog,
  hasOrder,
  onClose,
}: {
  event: EventRow;
  products: EventProduct[];
  catalog: Product[];
  hasOrder: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [lines, setLines] = useState<DraftLine[]>(
    products.length
      ? products.map((l) => ({ product_id: l.product_id, ordered_quantity: String(l.quantity), note: l.note ?? '' }))
      : [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Active products, plus any already on the list.
  const choices = catalog.filter((p) => p.is_active || products.some((l) => l.product_id === p.id));
  const filled = lines.filter((l) => l.product_id);
  const valid = filled.every((l) => toQuantity(l.ordered_quantity.replace(',', '.')) > 0);

  function submit() {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const res = await setEventProducts(
        event.id,
        filled.map((l) => ({ product_id: l.product_id, quantity: toQuantity(l.ordered_quantity.replace(',', '.')), note: l.note })),
      );
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('event.products')}
      description={hasOrder ? t('event.productsOrderHint') : event.stage === 'confirmed' ? t('event.productsNewOrderHint') : t('event.productsIdeaHint')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!valid}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {hasOrder && filled.length === 0 && <p className="text-[12.5px] font-medium text-warn">{t('event.productsEmptyCancels')}</p>}
        <OrderLineEditor lines={lines} onChange={setLines} products={choices} disabled={pending} />
      </div>
    </Dialog>
  );
}

function DeliveryDialog({
  event,
  date: initialDate,
  methodId: initialMethod,
  methods,
  onClose,
}: {
  event: EventRow;
  date: string;
  methodId: string | null;
  methods: DeliveryMethod[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [date, setDate] = useState(initialDate);
  const [methodId, setMethodId] = useState(initialMethod ?? methods.find((m) => m.slug === 'fabrica')?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choices = methods.filter((m) => m.is_active || m.id === initialMethod);

  function submit() {
    if (!date || !methodId) return;
    setError(null);
    startTransition(async () => {
      const res = await setEventDelivery(event.id, date, methodId);
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('event.delivery')}
      description={t('event.deliveryHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!date || !methodId}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('event.deliveryDate')} required htmlFor="event-delivery-date">
          <Input id="event-delivery-date" type="date" max={event.end_date} value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
        </Field>
        <Field label={t('event.deliveryMethod')} required htmlFor="event-delivery-method">
          <Select id="event-delivery-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            {choices.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function ReturnsDialog({
  event,
  products,
  returns,
  catalog,
  onClose,
}: {
  event: EventRow;
  products: EventProduct[];
  returns: EventReturn[];
  catalog: Product[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const [rows, setRows] = useState(
    products.map((l) => {
      const r = returns.find((x) => x.product_id === l.product_id);
      return {
        product_id: l.product_id,
        taken: l.prepared ?? l.quantity,
        back: r ? String(r.back_quantity) : '',
        discarded: r ? String(r.discarded_quantity) : '',
      };
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amount = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')));
  const valid = rows.every((r) => [r.back, r.discarded].every((v) => Number.isFinite(amount(v)) && amount(v) >= 0));
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function submit() {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const res = await saveReturns(
        event.id,
        rows.map((r) => ({ product_id: r.product_id, back_quantity: amount(r.back), discarded_quantity: amount(r.discarded) })),
      );
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('event.recordReturns')}
      description={t('event.returnsHint')}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!valid}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <div className="grid grid-cols-[1fr_5.5rem_5.5rem] items-end gap-x-2 gap-y-2 text-[13px]">
          <span className="text-[11.5px] text-muted">{t('event.product')}</span>
          <span className="text-[11.5px] text-muted">{t('event.cameBack')}</span>
          <span className="text-[11.5px] text-muted">{t('event.thrownAway')}</span>
          {rows.map((r, i) => {
            const p = byId.get(r.product_id);
            return (
              <div key={r.product_id} className="contents">
                <span className="min-w-0 self-center">
                  <span className="block truncate">{p ? productLabel(p) : '—'}</span>
                  <span className="text-[11.5px] text-muted">{t('event.takenCount', { quantity: num(r.taken) })}</span>
                </span>
                <Input
                  inputMode="decimal"
                  aria-label={`${t('event.cameBack')} · ${p ? productLabel(p) : ''}`}
                  value={r.back}
                  onChange={(e) => set(i, { back: e.target.value })}
                  autoFocus={i === 0}
                />
                <Input
                  inputMode="decimal"
                  aria-label={`${t('event.thrownAway')} · ${p ? productLabel(p) : ''}`}
                  value={r.discarded}
                  onChange={(e) => set(i, { discarded: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
