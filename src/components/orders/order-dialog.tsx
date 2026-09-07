'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
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
  // Postgres returns TIME as "HH:MM:SS"; <input type="time"> wants "HH:MM".
  const [deliveryTime, setDeliveryTime] = useState(order?.delivery_time?.slice(0, 5) ?? '');
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [cancelOpen, setCancelOpen] = useState(false);
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
    setFieldErrors({});

    // Per-field sentences, on the field. This used to set the form-level error
    // to a FIELD LABEL — a missing customer produced the message "Customer",
    // and no products produced "Add product" — displayed as a red block at the
    // foot of a long dialog with nothing highlighted. The Field primitive has
    // supported a per-field error all along; the skip dialog already uses it.
    const next: Record<string, string> = {};
    if (!customerId) next.customer = t('orders.chooseCustomer');
    if (!isValidSchedule(deliveryDate, preparationDate)) {
      next.preparation = t('orders.preparationAfterDelivery');
    }

    const cleaned = lines
      .filter((l) => l.product_id && toQuantity(l.ordered_quantity) > 0)
      .map((l) => ({
        id: l.id,
        product_id: l.product_id,
        ordered_quantity: toQuantity(l.ordered_quantity),
        note: l.note.trim() || null,
      }));
    if (cleaned.length === 0) next.lines = t('orders.needOneProduct');

    if (Object.keys(next).length > 0) {
      setFieldErrors(next);
      // Take the person to the first thing that needs fixing rather than
      // leaving them to find it in a form that scrolls.
      const first = next.customer ? 'o-customer' : next.preparation ? 'o-prep' : 'o-lines';
      document.getElementById(first)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      document.getElementById(first)?.focus?.();
      return;
    }

    startTransition(async () => {
      const res = await saveOrder(
        {
          customer_id: customerId,
          delivery_date: deliveryDate,
          delivery_time: deliveryTime || null,
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
          {/* Cancelling an order was a value in a dropdown you then had to
              Save — the one destructive action in the app with no button and
              no confirmation, while its confirmation text sat translated and
              unused. It is an action now, and it asks. */}
          {order && order.status !== 'cancelled' && (
            <Button
              variant="ghost"
              className="mr-auto text-late hover:bg-late/10 hover:text-late"
              onClick={() => setCancelOpen(true)}
              disabled={pending}
            >
              {t('orders.cancelOrder')}
            </Button>
          )}
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
        <Field label={t('orders.customer')} required htmlFor="o-customer" error={fieldErrors.customer}>
          {/* Searches company name AND trading name: "catedral" finds
              "5 Almas AG — La Catedral". */}
          <Combobox
            id="o-customer"
            items={customers}
            value={customerId || null}
            onChange={(id) => setCustomerId(id ?? '')}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => `${c.company_name} ${c.company_name_addition ?? ''}`}
            placeholder={t('orders.searchCustomer')}
            emptyMessage={t('orders.noCustomersFound')}
            renderOption={(c) => (
              <span className="block">
                <span className="block truncate">{c.company_name}</span>
                {c.company_name_addition && (
                  <span className="block truncate text-[11.5px] text-muted">
                    {c.company_name_addition}
                  </span>
                )}
              </span>
            )}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={t('orders.deliveryDate')} required htmlFor="o-delivery">
            <Input
              id="o-delivery"
              type="date"
              value={deliveryDate}
              onChange={(e) => changeDeliveryDate(e.target.value)}
            />
          </Field>
          {/* Optional. An empty time means no committed hour, and the
              countdown simply does not apply to the order. */}
          <Field
            label={t('urgency.deliveryTime')}
            hint={t('urgency.deliveryTimeHint')}
            htmlFor="o-delivery-time"
          >
            <Input
              id="o-delivery-time"
              type="time"
              value={deliveryTime}
              onChange={(e) => setDeliveryTime(e.target.value)}
            />
          </Field>
          <Field
            label={t('orders.preparationDate')}
            hint={t('orders.preparationHint')}
            htmlFor="o-prep"
            error={fieldErrors.preparation}
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
        <div id="o-lines" tabIndex={-1}>
          <p className="mb-1.5 text-[13px] font-medium">{t('orders.product')}</p>
          {fieldErrors.lines && (
            <p className="mb-1.5 text-[12px] text-late">{fieldErrors.lines}</p>
          )}
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="flex items-start gap-2">
                {/* Each line has its own selector; choosing on one never
                    touches another. Searches code AND name, so "0073",
                    "tortilla" and "1kg" all find their products. */}
                <Combobox
                  className="min-w-0 flex-1"
                  items={selectableProducts}
                  value={line.product_id || null}
                  onChange={(id) =>
                    setLines(lines.map((l, j) => (j === i ? { ...l, product_id: id ?? '' } : l)))
                  }
                  getKey={(p) => p.id}
                  getLabel={(p) => (p.code ? `${p.code} · ${productLabel(p)}` : productLabel(p))}
                  getSearchText={(p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family}`}
                  placeholder={t('orders.searchProduct')}
                  emptyMessage={t('orders.noProductsFound')}
                  renderOption={(p) => (
                    <span className="flex items-baseline gap-2">
                      <span className="w-12 shrink-0 tabular text-[11.5px] text-subtle">
                        {p.code ?? '—'}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{productLabel(p)}</span>
                    </span>
                  )}
                />
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

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => {
          setCancelOpen(false);
          setStatus('cancelled');
          // Saved immediately: asking twice — confirm, then Save — is how a
          // confirmation stops being read.
          startTransition(async () => {
            const res = await saveOrder(
              {
                customer_id: customerId,
                delivery_date: deliveryDate,
                delivery_time: deliveryTime || null,
                preparation_date: preparationDate,
                delivery_method_id: methodId || null,
                status: 'cancelled',
                order_type: orderType,
                note: note.trim() || null,
                lines: lines
                  .filter((l) => l.product_id && toQuantity(l.ordered_quantity) > 0)
                  .map((l) => ({
                    id: l.id,
                    product_id: l.product_id,
                    ordered_quantity: toQuantity(l.ordered_quantity),
                    note: l.note.trim() || null,
                  })),
              },
              order?.id,
            );
            if (!res.ok) return setError(res.error);
            onSaved();
          });
        }}
        title={t('orders.cancelOrder')}
        message={t('orders.cancelOrderConfirm')}
        confirmLabel={t('orders.cancelOrder')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
    </Dialog>
  );
}
