'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { ErrorState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { INCIDENT_SEVERITIES, vocabularyKey } from '@/domain/incidents/vocabulary';
import { createIncident } from '@/server/incident-actions';
import { productLabel, type Customer, type Product } from '@/types/orders';
import type { IncidentCategory, IncidentType } from '@/types/incidents';
import { categoryLabel, typeLabel } from './incident-list';

/**
 * Reporting an incident.
 *
 * §39, which is the whole design of this dialog: it asks for what happened
 * and nothing else. Cause, responsibility, investigation notes and resolution
 * are all absent — they belong to the investigation, which happens later on
 * the detail page, and demanding them here is how an incident log stops being
 * used at all. A person with a damaged box in front of them has about thirty
 * seconds of patience.
 *
 * When it is opened from an order, the customer, the delivery method and the
 * available products are already known and are not asked for again.
 */

/**
 * Build the context from a loaded order.
 *
 * One function because three places raise an incident from an order — the
 * order page header, the Order Control list, and anything that follows — and
 * three hand-built objects would drift on the day one of them forgets to
 * carry the lot allocations, which is the part nobody would notice missing
 * until an incident could not be traced to its lot.
 */
export function orderContextFrom(order: {
  id: string;
  reference: number;
  customer_id: string;
  customer: { name: string };
  order_date: string;
  preparation_date: string;
  delivery_date: string;
  delivery_method: { name: string } | null;
  lines: {
    id: string;
    product_id: string;
    product: Product;
    allocations: { id: string; lot_number: string }[];
  }[];
}): OrderContext {
  return {
    id: order.id,
    reference: order.reference,
    customer_id: order.customer_id,
    customer_name: order.customer.name,
    order_date: order.order_date,
    preparation_date: order.preparation_date,
    delivery_date: order.delivery_date,
    delivery_method_name: order.delivery_method?.name ?? null,
    lines: order.lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      product: l.product,
      allocations: (l.allocations ?? []).map((a) => ({ id: a.id, lot_number: a.lot_number })),
    })),
  };
}

/** What an order contributes when the incident is raised from one. */
export interface OrderContext {
  id: string;
  reference: number;
  customer_id: string;
  customer_name: string;
  order_date: string;
  preparation_date: string;
  delivery_date: string;
  delivery_method_name: string | null;
  lines: {
    id: string;
    product_id: string;
    product: Product;
    /** Lot allocations recorded during preparation, for tracing the lot. */
    allocations: { id: string; lot_number: string }[];
  }[];
}

interface DraftItem {
  product_id: string;
  order_line_id: string | null;
  lot_allocation_id: string | null;
  affected_quantity: string;
}

export function IncidentDialog({
  customers,
  products,
  categories,
  types,
  order,
  onClose,
  onSaved,
}: {
  customers: Customer[];
  products: Product[];
  categories: IncidentCategory[];
  types: IncidentType[];
  /** Prefills everything the order already knows. §6. */
  order?: OrderContext;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t, formatDate } = useI18n();

  const [customerId, setCustomerId] = useState(order?.customer_id ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [severity, setSeverity] = useState<(typeof INCIDENT_SEVERITIES)[number]>('medium');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const visibleTypes = categoryId ? types.filter((ty) => ty.category_id === categoryId) : [];

  // From an order, the choice is between the products on that order — which
  // is nearly always the right list and much shorter than the master.
  const selectableProducts = order
    ? order.lines.map((l) => l.product)
    : products.filter((p) => p.is_active);

  const addItem = () =>
    setItems([...items, { product_id: '', order_line_id: null, lot_allocation_id: null, affected_quantity: '' }]);

  function chooseProduct(index: number, productId: string) {
    // Choosing a product on an order-linked incident also resolves the order
    // line and, where preparation recorded exactly one lot, the lot too. That
    // is what makes the incident traceable to a lot without anybody typing a
    // lot number into a second place.
    const line = order?.lines.find((l) => l.product_id === productId);
    const onlyLot = line?.allocations.length === 1 ? line.allocations[0].id : null;
    setItems(items.map((it, i) =>
      i === index
        ? { ...it, product_id: productId, order_line_id: line?.id ?? null, lot_allocation_id: onlyLot }
        : it,
    ));
  }

  function submit() {
    setError(null);
    setFieldErrors({});

    const next: Record<string, string> = {};
    if (!typeId) next.type = t('incident.typeLabel');
    if (!description.trim()) next.description = t('incident.description');
    if (Object.keys(next).length > 0) return setFieldErrors(next);

    startTransition(async () => {
      const res = await createIncident({
        customer_id: customerId || null,
        order_id: order?.id ?? null,
        delivery_method_id: null,
        incident_type_id: typeId,
        severity,
        description: description.trim(),
        items: items
          .filter((it) => it.product_id)
          .map((it) => ({
            product_id: it.product_id,
            order_line_id: it.order_line_id,
            lot_allocation_id: it.lot_allocation_id,
            affected_quantity: it.affected_quantity ? Number(it.affected_quantity) : null,
          })),
      });

      if (!res.ok) return setError(t(errorKey(res.error)));
      onSaved(res.data.id);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('incident.new')}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {/* Everything the order already knows, shown rather than asked. */}
        {order ? (
          <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 text-[12.5px]">
            <p className="font-medium">
              {order.customer_name} · #{order.reference}
            </p>
            <p className="mt-0.5 text-muted">
              {t('incident.deliveryDate')}: {formatDate(order.delivery_date, 'short')} ·{' '}
              {t('incident.preparationDate')}: {formatDate(order.preparation_date, 'short')}
              {order.delivery_method_name ? ` · ${order.delivery_method_name}` : ''}
            </p>
          </div>
        ) : (
          <Field label={t('incident.customer')} hint={t('incident.orderUnknownHint')}>
            {/* §7: no order, and possibly no customer either. Neither is
                invented to satisfy a form. */}
            <Combobox
              items={customers}
              value={customerId || null}
              onChange={(id) => setCustomerId(id ?? '')}
              getKey={(c) => c.id}
              getLabel={(c) => c.name}
              getSearchText={(c) => `${c.company_name} ${c.company_name_addition ?? ''}`}
              placeholder={t('orders.searchCustomer')}
              emptyMessage={t('orders.noCustomersFound')}
            />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('incident.categoryLabel')} required htmlFor="i-cat">
            <Select
              id="i-cat"
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); setTypeId(''); }}
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{categoryLabel(t, c.slug, c.name)}</option>
              ))}
            </Select>
          </Field>

          <Field label={t('incident.typeLabel')} required htmlFor="i-type" error={fieldErrors.type}>
            <Select
              id="i-type"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              disabled={!categoryId}
            >
              <option value="">—</option>
              {visibleTypes.map((ty) => (
                <option key={ty.id} value={ty.id}>{typeLabel(t, ty.slug, ty.name)}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t('incident.severityLabel')} required htmlFor="i-sev">
          <Select
            id="i-sev"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
          >
            {INCIDENT_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t(`incident.severity.${vocabularyKey(s)}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('incident.description')}
          required
          htmlFor="i-desc"
          error={fieldErrors.description}
        >
          <Textarea
            id="i-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={t('incident.descriptionPlaceholder')}
          />
        </Field>

        {/* §15: several products, one incident. Optional, because a late
            delivery affects an order without affecting a product. */}
        <div>
          <p className="text-[13px] font-medium">{t('incident.affectedProducts')}</p>
          <p className="mb-2 mt-0.5 text-[12px] text-muted">{t('incident.affectedProductsHint')}</p>

          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <Combobox
                  className="min-w-0 flex-1"
                  items={selectableProducts}
                  value={item.product_id || null}
                  onChange={(id) => chooseProduct(i, id ?? '')}
                  getKey={(p) => p.id}
                  getLabel={(p) => (p.code ? `${p.code} · ${productLabel(p)}` : productLabel(p))}
                  getSearchText={(p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family}`}
                  placeholder={t('orders.searchProduct')}
                  emptyMessage={t('orders.noProductsFound')}
                />
                <Input
                  value={item.affected_quantity}
                  onChange={(e) =>
                    setItems(items.map((it, j) => (j === i ? { ...it, affected_quantity: e.target.value } : it)))
                  }
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  className="w-20 shrink-0"
                  aria-label={t('incident.affectedQuantity')}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  aria-label={t('incident.removeProduct')}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            ))}
          </div>

          <Button size="sm" variant="secondary" className="mt-2" onClick={addItem}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('incident.addProduct')}
          </Button>
        </div>

        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}

/** Every error the incident actions return, as a translated sentence. */
export function errorKey(code: string): MessageKey {
  const map: Record<string, MessageKey> = {
    not_authorized: 'incident.errNotAuthorized',
    invalid_incident: 'incident.errInvalid',
    invalid_items: 'incident.errInvalid',
    invalid_action: 'incident.errInvalid',
    invalid_replacement: 'incident.errInvalid',
    incident_not_found: 'incident.errNotFound',
    order_not_found: 'incident.errOrderNotFound',
    close_not_permitted: 'incident.errCloseNotPermitted',
    reopen_not_permitted: 'incident.errReopenNotPermitted',
    backward_not_permitted: 'incident.errBackwardNotPermitted',
    close_requires_resolved: 'incident.errCloseRequiresResolved',
    resolution_notes_required: 'incident.errResolutionRequired',
    secondary_cause_is_primary: 'incident.errSecondaryIsPrimary',
    replacement_empty: 'incident.errReplacementEmpty',
    // Retrying will not help: the number names somebody else's delivery.
    replacement_customer_mismatch: 'incident.errReplacementCustomer',
    evidence_too_large: 'incident.errEvidenceTooLarge',
    evidence_type_not_allowed: 'incident.errEvidenceType',
  };
  return map[code] ?? 'incident.errSaveFailed';
}
