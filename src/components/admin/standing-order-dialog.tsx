'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { nextStandingDelivery } from '@/domain/orders/scheduling';
import { businessToday } from '@/lib/datetime';
import { saveTemplate } from '@/server/order-actions';
import type { Customer, DeliveryMethod, Product, RecurringTemplate } from '@/types/orders';

/**
 * Creating and editing a standing order.
 *
 * THIS IS THE PIECE THAT WAS MISSING. saveTemplate() has existed in the
 * server layer since the orders module shipped, and no screen ever called it
 * — templates could only arrive through the Excel importer. Production had
 * none, which is what "we cannot do standing orders" actually meant.
 *
 * A template describes what to order and when, and nothing about a particular
 * delivery: the quantities are DEFAULTS the generated draft starts from, not
 * a commitment. Editing a template never touches an order it already
 * produced, which is what lets somebody correct next month's standing order
 * without rewriting last month's history.
 */
export function StandingOrderDialog({
  template,
  customers,
  products,
  deliveryMethods,
  onClose,
}: {
  template: RecurringTemplate | null;
  customers: Customer[];
  products: Product[];
  deliveryMethods: DeliveryMethod[];
  onClose: () => void;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const today = businessToday();

  const [customerId, setCustomerId] = useState<string | null>(template?.customer_id ?? null);
  const [weekday, setWeekday] = useState(String(template?.delivery_weekday ?? 2));
  const [intervalWeeks, setIntervalWeeks] = useState(String(template?.interval_weeks ?? 1));
  const [anchorDate, setAnchorDate] = useState(template?.anchor_date ?? today);
  const [leadDays, setLeadDays] = useState(String(template?.preparation_lead_days ?? 0));
  const [methodId, setMethodId] = useState(template?.delivery_method_id ?? '');
  const [orderType, setOrderType] = useState(template?.order_type ?? 'sale');
  const [note, setNote] = useState(template?.note ?? '');
  const [isActive, setIsActive] = useState(template?.is_active ?? false);
  const [lines, setLines] = useState<{ product_id: string; quantity: string }[]>(
    () =>
      template?.lines?.map((l) => ({
        product_id: l.product_id,
        quantity: String(l.default_quantity),
      })) ?? [],
  );

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const interval = Number(intervalWeeks) || 1;

  // The SAME function the scheduler uses, so the date previewed here is the
  // date the cron will actually create an order for.
  const preview = nextStandingDelivery(
    {
      weekday: Number(weekday),
      intervalWeeks: interval,
      anchorDate: interval > 1 ? anchorDate : null,
    },
    today,
  );

  const validLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
  const ready = customerId !== null && validLines.length > 0;

  function submit() {
    startTransition(async () => {
      const res = await saveTemplate(
        {
          customer_id: customerId!,
          delivery_weekday: Number(weekday),
          interval_weeks: interval,
          anchor_date: interval > 1 ? anchorDate : null,
          preparation_lead_days: Number(leadDays) || 0,
          delivery_method_id: methodId || null,
          order_type: orderType as 'sale' | 'sample' | 'replacement',
          note: note.trim() || null,
          is_active: isActive,
          lines: validLines.map((l) => ({
            product_id: l.product_id,
            default_quantity: Number(l.quantity),
          })),
        },
        template?.id,
      );

      if (!res.ok) setError(res.error);
      else {
        onClose();
        router.refresh();
      }
    });
  }

  const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

  return (
    <Dialog
      open
      onClose={onClose}
      title={template ? t('master.editStanding') : t('master.newStanding')}
      description={t('master.standingHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={pending} disabled={!ready} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('orders.customer')} required>
          <Combobox
            items={customers.filter((c) => c.is_active || c.id === template?.customer_id)}
            value={customerId}
            onChange={setCustomerId}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => `${c.company_name} ${c.company_name_addition ?? ''}`}
            placeholder={t('orders.customer')}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('master.deliveryWeekday')} required>
            <Select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {t(`weekday.${d}` as never)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('master.intervalWeeks')} hint={t('master.intervalHint')}>
            <Select value={intervalWeeks} onChange={(e) => setIntervalWeeks(e.target.value)}>
              <option value="1">{t('master.everyWeek')}</option>
              <option value="2">{t('master.everyNWeeks', { n: 2 })}</option>
              <option value="3">{t('master.everyNWeeks', { n: 3 })}</option>
              <option value="4">{t('master.everyNWeeks', { n: 4 })}</option>
            </Select>
          </Field>
        </div>

        {/* Only asked for when it means something. At weekly there is nothing
            to anchor, and showing the field would invite somebody to set it
            and expect it to matter. */}
        {interval > 1 && (
          <Field label={t('master.anchorDate')} hint={t('master.anchorHint')} required>
            <Input
              type="date"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
            />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('master.leadDays')} hint={t('master.leadDaysHint')}>
            <Input
              type="number"
              min="0"
              max="30"
              value={leadDays}
              onChange={(e) => setLeadDays(e.target.value)}
            />
          </Field>

          <Field label={t('orders.deliveryMethod')}>
            <Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              <option value="">—</option>
              {deliveryMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {preview && (
          <p className="rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-[12.5px] text-muted">
            {t('master.nextDelivery')}: <span className="font-medium text-fg">{formatDate(preview, 'medium')}</span>
          </p>
        )}

        {/* ---- what to order ---- */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium">{t('master.templateLines')}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLines((p) => [...p, { product_id: '', quantity: '' }])}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('master.addTemplateLine')}
            </Button>
          </div>

          {lines.length === 0 && (
            <p className="text-[12.5px] text-muted">{t('master.templateLinesHint')}</p>
          )}

          {lines.map((line, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  items={products.filter((p) => p.is_active || p.id === line.product_id)}
                  value={line.product_id || null}
                  onChange={(id) =>
                    setLines((prev) =>
                      prev.map((l, i) => (i === index ? { ...l, product_id: id ?? '' } : l)),
                    )
                  }
                  getKey={(p) => p.id}
                  getLabel={(p) => `${p.family} · ${p.presentation}`}
                  getSearchText={(p) => `${p.code ?? ''} ${p.family} ${p.presentation}`}
                  placeholder={t('orders.product')}
                />
              </div>

              <Input
                className="w-24 text-center tabular-nums"
                type="number"
                min="0"
                step="0.001"
                inputMode="decimal"
                placeholder={t('orders.quantity')}
                aria-label={t('orders.quantity')}
                value={line.quantity}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)),
                  )
                }
              />

              <Button
                size="icon"
                variant="ghost"
                aria-label={t('common.delete')}
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5 text-late" aria-hidden />
              </Button>
            </div>
          ))}
        </div>

        <Field label={t('orders.orderNote')}>
          <Textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {/* Inactive by default, and the label says what that means. An active
            template starts producing drafts on the next nightly run. */}
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>
            <span className="block text-[13px] font-medium">{t('master.templateActive')}</span>
            <span className="mt-0.5 block text-[12px] text-muted">
              {t('master.templateActiveHint')}
            </span>
          </span>
        </label>

        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
