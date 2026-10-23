'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { saveSupplierDetails, type SupplierDetailsInput } from '@/server/supplier-actions';
import type { SupplierDetails, SupplierOrderCard } from '@/server/suppliers';

const TEXT_FIELDS = [
  'contact_person', 'email', 'phone', 'mobile', 'website', 'street', 'postal_code', 'city', 'country',
  'our_customer_no', 'vat_no', 'uid_no', 'iban', 'payment_terms', 'notes',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * A supplier's details, for the office: contact, address, ordering, tax and
 * payment. How to order lives on the Guías card and is shown here as it is.
 */
export function SupplierDetailsDialog({
  supplierName,
  supplierId,
  details,
  card,
  onClose,
}: {
  supplierName: string;
  supplierId: string;
  details: SupplierDetails | null;
  card: SupplierOrderCard | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<TextField, string>>(
    () => Object.fromEntries(TEXT_FIELDS.map((k) => [k, details?.[k] ?? ''])) as Record<TextField, string>,
  );
  const [days, setDays] = useState<number[]>(details?.order_days ?? []);
  const [leadTime, setLeadTime] = useState(details?.lead_time_days != null ? String(details.lead_time_days) : '');
  const set = (k: TextField) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const input = (k: TextField, label: MessageKey, props: Record<string, unknown> = {}) => (
    <Field label={t(label)} htmlFor={`sd-${k}`}>
      <Input id={`sd-${k}`} value={form[k]} onChange={set(k)} {...props} />
    </Field>
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const values = Object.fromEntries(TEXT_FIELDS.map((k) => [k, form[k].trim() || null])) as Record<TextField, string | null>;
      const res = await saveSupplierDetails(supplierId, {
        ...values,
        country: values.country ? values.country.toUpperCase() : null,
        order_days: days.length ? [...days].sort() : null,
        lead_time_days: leadTime === '' ? null : Number(leadTime),
      } satisfies SupplierDetailsInput);
      if (!res.ok) return setError(res.error === 'not_authorized' ? t('supplierDetails.notAuthorized') : res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={supplierName}
      description={details?.bexio_no ? `bexio ${details.bexio_no}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorState message={error} />}

        <section className="space-y-3">
          <p className="text-[13px] font-medium">{t('supplierDetails.contact')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {input('contact_person', 'supplierDetails.contactPerson')}
            {input('email', 'customerContact.email', { type: 'email' })}
            {input('phone', 'customerContact.phone', { type: 'tel' })}
            {input('mobile', 'customerContact.mobile', { type: 'tel' })}
          </div>
          {input('website', 'customerContact.website')}
        </section>

        <section className="space-y-3">
          <p className="text-[13px] font-medium">{t('supplierDetails.address')}</p>
          {input('street', 'master.street')}
          <div className="grid grid-cols-3 gap-3">
            {input('postal_code', 'master.postalCode')}
            {input('city', 'master.city')}
            {input('country', 'master.country', { maxLength: 2 })}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-[13px] font-medium">{t('supplierDetails.ordering')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {input('our_customer_no', 'supplierDetails.ourCustomerNo')}
            <Field label={t('supplierDetails.leadTime')} hint={t('supplierDetails.leadTimeHint')} htmlFor="sd-lead">
              <Input id="sd-lead" type="number" inputMode="numeric" min="0" max="365" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
            </Field>
          </div>
          <Field label={t('supplierDetails.orderDays')}>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days.includes(d)}
                  onClick={() => setDays((all) => (all.includes(d) ? all.filter((x) => x !== d) : [...all, d]))}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                    days.includes(d) ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-fg',
                  )}
                >
                  {t(`supplierDetails.day.${d}` as MessageKey)}
                </button>
              ))}
            </div>
          </Field>
          {/* How to order: the Guías card, edited there. */}
          <div className="rounded-lg bg-surface-2 p-2.5 text-[12.5px]">
            <p className="mb-1 font-medium">{t('supplierDetails.guideCard')}</p>
            {card && (card.how || card.contact || card.minimum || card.deadline) ? (
              <dl className="space-y-0.5 text-muted">
                {card.how && <div><dt className="inline font-medium text-fg">{t('supplierDetails.how')}: </dt><dd className="inline whitespace-pre-line">{card.how}</dd></div>}
                {card.contact && <div><dt className="inline font-medium text-fg">{t('supplierDetails.cardContact')}: </dt><dd className="inline">{card.contact}</dd></div>}
                {card.minimum && <div><dt className="inline font-medium text-fg">{t('supplierDetails.minimum')}: </dt><dd className="inline">{card.minimum}</dd></div>}
                {card.deadline && <div><dt className="inline font-medium text-fg">{t('supplierDetails.deadline')}: </dt><dd className="inline">{card.deadline}</dd></div>}
              </dl>
            ) : (
              <p className="text-muted">{t('supplierDetails.noCard')}</p>
            )}
            <Link href="/guide" className="mt-1 inline-block font-medium text-accent hover:underline">{t('supplierDetails.editInGuide')}</Link>
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-[13px] font-medium">{t('supplierDetails.taxPayment')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {input('uid_no', 'customerContact.uid')}
            {input('vat_no', 'customerContact.vat')}
            {input('iban', 'supplierDetails.iban')}
            {input('payment_terms', 'supplierDetails.paymentTerms', { placeholder: t('supplierDetails.paymentTermsPlaceholder') })}
          </div>
        </section>

        <Field label={t('supplierDetails.notes')} htmlFor="sd-notes">
          <NoteTextarea id="sd-notes" value={form.notes} maxLength={4000} onChange={set('notes')} rows={3} />
        </Field>
      </div>
    </Dialog>
  );
}
