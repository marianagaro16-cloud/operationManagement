'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { defaultPreparationDate, isValidSchedule } from '@/domain/orders/scheduling';
import { toQuantity } from '@/domain/orders/progress';
import { businessToday } from '@/lib/datetime';
import { productLabel, type Customer, type DeliveryMethod, type Order, type Product } from '@/types/orders';
import { saveOrder } from '@/server/order-actions';

interface DraftLine {
  id?: string;
  product_id: string;
  ordered_quantity: string;
  note: string;
}

/**
 * Admin order editor. The order is entered ONCE here and feeds both Order
 * Control and Lotnummerkontrol — there is no second form for preparation.
 */
export function OrderDialog({
  order,
  customers,
  products,
  deliveryMethods,
  onClose,
  onSaved,
}: {
  order: Order | null;
  customers: Customer[];
  products: Product[];
  deliveryMethods: DeliveryMethod[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const today = businessToday();

  const [customerId, setCustomerId] = useState(order?.customer_id ?? '');
  const [deliveryDate, setDeliveryDate] = useState(order?.delivery_date ?? today);
  const [preparationDate, setPreparationDate] = useState(
    order?.preparation_date ?? defaultPreparationDate(today),
  );
  // Once an admin moves preparation, stop following the delivery date.
  const [prepTouched, setPrepTouched] = useState(
    order ? order.preparation_date !== order.delivery_date : false,
  );
  const [methodId, setMethodId] = useState(order?.delivery_method_id ?? '');
  const [status, setStatus] = useState<Order['status']>(order?.status ?? 'confirmed');
  const [orderType, setOrderType] = useState<Order['order_type']>(order?.order_type ?? 'sale');
  const [note, setNote] = useState(order?.note ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    order?.lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      ordered_quantity: String(toQuantity(l.ordered_quantity)),
      note: l.note ?? '',
    })) ?? [{ product_id: '', ordered_quantity: '', note: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Historical orders must keep showing an inactive product; new lines may
  // only pick active ones.
  const usedProductIds = new Set(order?.lines.map((l) => l.product_id) ?? []);
  const selectableProducts = products.filter((p) => p.is_active || usedProductIds.has(p.id));

  function changeDeliveryDate(value: string) {
    setDeliveryDate(value);
    if (!prepTouched) setPreparationDate(defaultPreparationDate(value));
  }

  function submit() {
    setError(null);
    if (!customerId) return setError(t('orders.customer'));
    if (!isValidSchedule(deliveryDate, preparationDate)) {
      return setError(t('orders.preparationAfterDelivery'));
    }
    const cleaned = lines
      .filter((l) => l.product_id && toQuantity(l.ordered_quantity) > 0)
      .map((l) => ({
        id: l.id,
        product_id: l.product_id,
        ordered_quantity: toQuantity(l.ordered_quantity),
        note: l.note.trim() || null,
      }));
    if (cleaned.length === 0) return setError(t('orders.addProduct'));

    startTransition(async () => {
      const res = await saveOrder(
        {
          customer_id: customerId,
          delivery_date: deliveryDate,
          preparation_date: preparationDate,
          delivery_method_id: methodId || null,
          status,
          order_type: orderType,
          note: note.trim() || null,
          lines: cleaned,
        },
        order?.id,
      );
      if (!res.ok) {
        const map: Record<string, string> = {
          preparation_after_delivery: t('orders.preparationAfterDelivery'),
          customer_inactive: t('orders.customerInactive'),
          product_inactive: t('orders.productInactive'),
        };
        return setError(map[res.error] ?? res.error);
      }
      onSaved();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={order ? t('orders.editOrder') : t('orders.newOrder')}
      description={t('orders.splitHint')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label={t('orders.customer')} required htmlFor="o-customer">
          <Select id="o-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">—</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('orders.deliveryDate')} required htmlFor="o-delivery">
            <Input
              id="o-delivery"
              type="date"
              value={deliveryDate}
              onChange={(e) => changeDeliveryDate(e.target.value)}
            />
          </Field>
          <Field
            label={t('orders.preparationDate')}
            hint={t('orders.preparationHint')}
            htmlFor="o-prep"
          >
            <Input
              id="o-prep"
              type="date"
              value={preparationDate}
              onChange={(e) => { setPrepTouched(true); setPreparationDate(e.target.value); }}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('orders.deliveryMethod')} htmlFor="o-method">
            <Select id="o-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              <option value="">—</option>
              {deliveryMethods.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('orders.orderStatus')} htmlFor="o-status">
            <Select
              id="o-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as Order['status'])}
            >
              <option value="draft">{t('orders.statusDraft')}</option>
              <option value="confirmed">{t('orders.statusConfirmed')}</option>
              <option value="cancelled">{t('orders.statusCancelled')}</option>
            </Select>
          </Field>
          <Field label={t('orders.orderType')} htmlFor="o-type">
            <Select
              id="o-type"
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as Order['order_type'])}
            >
              <option value="sale">{t('orders.typeSale')}</option>
              <option value="sample">{t('orders.typeSample')}</option>
            </Select>
          </Field>
        </div>

        {/* Products */}
        <div>
          <p className="mb-1.5 text-[13px] font-medium">{t('orders.product')}</p>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="flex items-start gap-2">
                <Select
                  value={line.product_id}
                  onChange={(e) =>
                    setLines(lines.map((l, j) => (j === i ? { ...l, product_id: e.target.value } : l)))
                  }
                  aria-label={t('orders.product')}
                  className="min-w-0 flex-1"
                >
                  <option value="">—</option>
                  {selectableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {productLabel(p)}{p.code ? ` (${p.code})` : ''}{!p.is_active ? ' ·' : ''}
                    </option>
                  ))}
                </Select>
                <Input
                  value={line.ordered_quantity}
                  onChange={(e) =>
                    setLines(lines.map((l, j) => (j === i ? { ...l, ordered_quantity: e.target.value } : l)))
                  }
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  className="w-20 shrink-0"
                  aria-label={t('orders.quantity')}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  aria-label={t('orders.removeLine')}
                  disabled={lines.length === 1}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => setLines([...lines, { product_id: '', ordered_quantity: '', note: '' }])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('orders.addProduct')}
          </Button>
        </div>

        <Field label={t('orders.orderNote')} hint={t('orders.orderNoteHint')} htmlFor="o-note">
          <Textarea id="o-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>

        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}
