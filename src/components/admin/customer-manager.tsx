'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { filterByQuery } from '@/lib/search';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { saveCustomer, setCustomerType } from '@/server/order-actions';
import type { Customer, CustomerType } from '@/types/orders';

/**
 * A segment's label.
 *
 * The slug is the dictionary key and `name` is the fallback, so a segment
 * added later that no dictionary knows about still renders as something
 * readable rather than as a raw key.
 */
function useTypeLabel() {
  const { t } = useI18n();
  return (type: CustomerType | null | undefined) => {
    if (!type) return t('master.typeNone');
    const key = `master.customerType.${type.slug}` as MessageKey;
    const translated = t(key);
    return translated === key ? type.name : translated;
  };
}

/**
 * Customer master.
 *
 * Company name and its addition are stored and edited separately — the legal
 * entity ("5 Almas AG") and the trading name ("La Catedral") are different
 * facts, and the trading name is what the operations team actually says.
 *
 * Nothing is ever deleted here. A customer absent from the master file is
 * deactivated, which keeps it on historical orders while removing it from
 * the picker for new ones.
 */
export function CustomerManager({
  customers,
  customerTypes,
}: {
  customers: Customer[];
  customerTypes: CustomerType[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  // '' is every segment; 'none' is the unclassified backlog, which needs to be
  // reachable in one click or nobody will ever work through it.
  const [typeFilter, setTypeFilter] = useState('');
  const typeLabel = useTypeLabel();

  const inactiveCount = customers.filter((c) => !c.is_active).length;
  // Named on the filter itself, so the size of the backlog is visible without
  // anybody having to go looking for it.
  const unclassified = customers.filter((c) => c.is_active && !c.customer_type_id).length;

  // The same matcher the order picker uses: accent-folded and multi-term, so
  // "wulflingen" finds Wülflingen here as well. This screen used to roll its
  // own lowercase substring test, which meant the same typed string found a
  // customer on one screen and reported nothing on another.
  const visible = useMemo(
    () =>
      filterByQuery(
        customers
          .filter((c) => showInactive || c.is_active)
          .filter((c) =>
            typeFilter === ''
              ? true
              : typeFilter === 'none'
                ? !c.customer_type_id
                : c.customer_type_id === typeFilter,
          ),
        query,
        // Search covers BOTH fields, since the team may know either.
        (c) => `${c.company_name} ${c.company_name_addition ?? ''}`,
      ),
    [customers, query, showInactive, typeFilter],
  );

  return (
    <>
      <PageHeader
        title={t('master.customersTitle')}
        subtitle={t('master.customersSubtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('master.newCustomer')}
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('master.searchCustomers')}
          className="max-w-xs"
          aria-label={t('common.search')}
        />
        {inactiveCount > 0 && (
          <button
            onClick={() => setShowInactive((v) => !v)}
            aria-pressed={showInactive}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              showInactive
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border bg-surface text-muted hover:text-fg',
            )}
          >
            {t('master.showInactive', { count: inactiveCount })}
          </button>
        )}
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label={t('master.customerTypeLabel')}
          className="max-w-[13rem]"
        >
          <option value="">{t('master.typeAll')}</option>
          {customerTypes
            .filter((ct) => ct.is_active)
            .map((ct) => (
              <option key={ct.id} value={ct.id}>
                {typeLabel(ct)}
              </option>
            ))}
          <option value="none">
            {t('master.typeNoneCount', { count: unclassified })}
          </option>
        </Select>

        <span className="text-[12px] text-subtle">
          {t('master.showingCount', { shown: visible.length, total: customers.length })}
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState title={t('stats.noData')} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {visible.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-[13.5px]', !c.is_active && 'text-muted line-through')}>
                    {c.company_name}
                  </p>
                  {c.company_name_addition && (
                    <p className="truncate text-[11.5px] text-muted">{c.company_name_addition}</p>
                  )}
                </div>
                {/* Classifying happens HERE rather than only in the dialog:
                    221 customers arrived unclassified, and a modal per
                    customer is a chore nobody finishes. */}
                <TypeSelect customer={c} customerTypes={customerTypes} />

                <Badge tone={c.is_active ? 'done' : 'neutral'}>
                  {c.is_active ? t('status.active') : t('status.inactive')}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setEditing(c)}
                  aria-label={t('common.edit')}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(creating || editing) && (
        <CustomerDialog
          key={editing?.id ?? 'new'}
          customer={editing}
          customerTypes={customerTypes}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function CustomerDialog({
  customer,
  customerTypes,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  customerTypes: CustomerType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [companyName, setCompanyName] = useState(customer?.company_name ?? '');
  const [addition, setAddition] = useState(customer?.company_name_addition ?? '');
  const [typeId, setTypeId] = useState(customer?.customer_type_id ?? '');
  const [active, setActive] = useState(customer?.is_active ?? true);
  const typeLabel = useTypeLabel();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveCustomer(
        {
          company_name: companyName,
          company_name_addition: addition || null,
          customer_type_id: typeId || null,
          is_active: active,
        },
        customer?.id,
      );
      if (!res.ok) return setError(res.error);
      onSaved();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={customer ? t('common.edit') : t('master.newCustomer')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!companyName.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label={t('master.companyName')} required htmlFor="c-name">
          <Input id="c-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoFocus />
        </Field>

        <Field
          label={t('master.companyNameAddition')}
          hint={t('master.companyNameAdditionHint')}
          htmlFor="c-addition"
        >
          <Input id="c-addition" value={addition} onChange={(e) => setAddition(e.target.value)} />
        </Field>

        {/* Optional on purpose. A new customer whose segment is not yet
            decided is recorded as unclassified rather than guessed at. */}
        <Field label={t('master.customerTypeLabel')} htmlFor="c-type">
          <Select id="c-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">{t('master.typeNone')}</option>
            {customerTypes
              .filter((ct) => ct.is_active || ct.id === customer?.customer_type_id)
              .map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {typeLabel(ct)}
                </option>
              ))}
          </Select>
        </Field>

        <Checkbox
          label={t('status.active')}
          hint={t('master.activeHint')}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />

        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}

/**
 * The segment dropdown that lives in the list row.
 *
 * Writes immediately and optimistically: this is used to work down a list of
 * a couple of hundred customers, and a Save button per row would double the
 * taps for no gain. On refusal the previous value goes back, because a
 * control that keeps showing a choice the database rejected is lying.
 *
 * Retired segments are still offered when the customer already carries one —
 * otherwise the dropdown would silently display the wrong segment for a
 * customer classified before that segment was retired.
 */
function TypeSelect({
  customer,
  customerTypes,
}: {
  customer: Customer;
  customerTypes: CustomerType[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const typeLabel = useTypeLabel();
  const [value, setValue] = useState(customer.customer_type_id ?? '');
  const [pending, startTransition] = useTransition();

  const options = customerTypes.filter((ct) => ct.is_active || ct.id === customer.customer_type_id);

  function change(next: string) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await setCustomerType(customer.id, next || null);
      if (!res.ok) setValue(previous);
      else router.refresh();
    });
  }

  return (
    <Select
      value={value}
      disabled={pending}
      onChange={(e) => change(e.target.value)}
      aria-label={t('master.customerTypeLabel')}
      className={cn(
        'h-8 w-[9.5rem] shrink-0 py-0 text-[12.5px]',
        // An unclassified customer is not an error, so it is not red — it is
        // simply quieter than one that has been decided.
        !value && 'text-subtle',
      )}
    >
      <option value="">{t('master.typeNone')}</option>
      {options.map((ct) => (
        <option key={ct.id} value={ct.id}>
          {typeLabel(ct)}
        </option>
      ))}
    </Select>
  );
}
