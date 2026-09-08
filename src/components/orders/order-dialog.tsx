'use client';

import { useRef, useState, useTransition } from 'react';
import { FileSpreadsheet, Keyboard, Mail } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { defaultPreparationDate, isValidSchedule } from '@/domain/orders/scheduling';
import { toQuantity } from '@/domain/orders/progress';
import type { PreviewLine } from '@/domain/orders/import/pipeline';
import { businessToday } from '@/lib/datetime';
import { productLabel, type Customer, type DeliveryMethod, type Order, type Product } from '@/types/orders';
import { saveOrder } from '@/server/order-actions';
import { ImportPanel, type ImportMethod } from './import-panel';
import { OrderLineEditor, emptyLine, type DraftLine } from './order-line-editor';

/**
 * Order editor. The order is entered ONCE here and feeds both Order Control
 * and Lotnummerkontrol — there is no second form for preparation.
 *
 * Three ways to fill the product lines, one way to create the order.
 *
 *   A. Manual entry              — the keyboard-first line editor
 *   B. Import Order Request      — a customer's Excel file
 *   C. Paste Email / Order Text  — deterministic extraction from a message
 *
 * B and C both end by APPENDING draft lines to this form. They never create an
 * order themselves. That is deliberate and is what makes an imported order
 * indistinguishable from a hand-entered one everywhere downstream: the
 * customer, the dates, the delivery method, the validation, the audit trail
 * and the save are the ones that were already here.
 */
export function OrderDialog({
  order,
  customers,
  products,
  deliveryMethods,
  initial,
  onClose,
  onSaved,
}: {
  order: Order | null;
  customers: Customer[];
  products: Product[];
  deliveryMethods: DeliveryMethod[];
  /**
   * Starting values for a NEW order — used when something else already knows
   * what the order should contain. A replacement raised from an incident
   * arrives with the customer and the affected products already filled in,
   * so nobody retypes what the incident already recorded.
   *
   * Ignored when editing: an existing order IS its own starting values.
   */
  initial?: { customer_id?: string; note?: string; lines?: { product_id: string; ordered_quantity: string }[] };
  onClose: () => void;
  /**
   * Receives the id of the order that was saved.
   *
   * Callers that only refresh a list ignore it; the incident module uses it to
   * link the replacement order it just raised back to the incident.
   */
  onSaved: (id: string) => void;
}) {
  const { t } = useI18n();
  const today = businessToday();

  const [customerId, setCustomerId] = useState(order?.customer_id ?? initial?.customer_id ?? '');
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
  const [note, setNote] = useState(order?.note ?? initial?.note ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    order?.lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      ordered_quantity: String(toQuantity(l.ordered_quantity)),
      note: l.note ?? '',
      source_text: l.source_text,
    })) ??
      // A new order, possibly with lines somebody else already knows about.
      (initial?.lines?.length
        ? initial.lines.map((l) => ({ ...l, note: '' }))
        : [emptyLine()]),
  );

  /**
   * Which method is open. Editing an existing order starts on manual — an
   * import fills an order in, it does not re-fill one that already exists.
   */
  const [importMethod, setImportMethod] = useState<ImportMethod | null>(null);
  /** Null until something was imported; then the order carries its origin. */
  const [importSource, setImportSource] = useState<ImportMethod | null>(null);

  /**
   * The idempotency key for THIS dialog.
   *
   * Minted once per import and sent with the save, so a double tap or a
   * retried request on a flaky warehouse connection collides with the unique
   * index in Postgres instead of becoming a second real delivery. Held in a
   * ref because regenerating it on a re-render would defeat the point.
   */
  const importKey = useRef<string | null>(null);

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

  /**
   * Accepted preview lines become ordinary draft lines.
   *
   * They are APPENDED, never substituted: a user who typed two products by
   * hand and then imported a file gets both. The one empty starter line is
   * dropped, because it is scaffolding rather than something they entered.
   */
  function acceptImported(imported: PreviewLine[], source: ImportMethod) {
    const existing = lines.filter((l) => l.product_id || l.ordered_quantity.trim());
    const added: DraftLine[] = imported
      .filter((l) => l.productId && l.quantity !== null)
      .map((l) => ({
        product_id: l.productId as string,
        ordered_quantity: String(l.quantity),
        // The customer's own comment goes into the EXISTING order line note.
        // No second note system is created for imports.
        note: l.note ?? '',
        source_text: l.sourceText || null,
      }));

    setLines([...existing, ...added]);
    setImportSource(source);
    if (!importKey.current) importKey.current = newImportKey();
    setImportMethod(null);
    setFieldErrors({});
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
        source_text: l.source_text ?? null,
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
          import_source: importSource,
          import_key: importSource ? importKey.current : null,
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
      onSaved(res.data.id);
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
          {/* `loading` disables the button, so the double click that would
              have produced a second order cannot reach the action at all.
              The import key is the guard for everything that gets past it. */}
          <Button variant="primary" onClick={submit} loading={pending}>
            {order ? t('common.save') : t('orders.createOrder')}
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
          <p className="mb-1.5 text-[13px] font-medium">{t('import.howToAdd')}</p>

          <div className="mb-2.5 flex flex-wrap gap-1.5">
            <MethodButton
              active={importMethod === null}
              onClick={() => setImportMethod(null)}
              icon={<Keyboard className="h-3.5 w-3.5" aria-hidden />}
              label={t('import.methodManual')}
            />
            <MethodButton
              active={importMethod === 'excel'}
              onClick={() => setImportMethod('excel')}
              icon={<FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />}
              label={t('import.methodExcel')}
            />
            <MethodButton
              active={importMethod === 'email'}
              onClick={() => setImportMethod('email')}
              icon={<Mail className="h-3.5 w-3.5" aria-hidden />}
              label={t('import.methodEmail')}
            />
          </div>

          {fieldErrors.lines && (
            <p className="mb-1.5 text-[12px] text-late">{fieldErrors.lines}</p>
          )}

          {importMethod ? (
            <ImportPanel
              method={importMethod}
              customerId={customerId}
              products={selectableProducts}
              onImported={acceptImported}
              onCancel={() => setImportMethod(null)}
            />
          ) : (
            <>
              <p className="mb-2 text-[11.5px] text-subtle">{t('import.keyboardHint')}</p>
              <OrderLineEditor
                lines={lines}
                onChange={setLines}
                products={selectableProducts}
                disabled={pending}
              />
            </>
          )}
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
                import_source: importSource,
                import_key: importSource ? importKey.current : null,
                lines: lines
                  .filter((l) => l.product_id && toQuantity(l.ordered_quantity) > 0)
                  .map((l) => ({
                    id: l.id,
                    product_id: l.product_id,
                    ordered_quantity: toQuantity(l.ordered_quantity),
                    note: l.note.trim() || null,
                    source_text: l.source_text ?? null,
                  })),
              },
              order?.id,
            );
            if (!res.ok) return setError(res.error);
            onSaved(res.data.id);
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

function MethodButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium',
        'transition-colors touch-target',
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border bg-surface text-muted hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * A key for one import session.
 *
 * crypto.randomUUID is not available on every browser this PWA runs on — an
 * older iPad in the warehouse among them — and an import that threw here
 * would be an import that could not happen at all, so there is a fallback.
 */
function newImportKey(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
