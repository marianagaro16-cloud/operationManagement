'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, Pencil, Plus, Search } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { filterByQuery } from '@/lib/search';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shell/app-shell';
import {
  Badge,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import {
  saveCustomerSpecification,
  setSpecificationActive,
} from '@/server/order-actions';
import type { Customer, CustomerSpecification, SpecificationType } from '@/types/orders';

/**
 * Customer specifications — one combined list.
 *
 * Standing reminders about invoicing and transport arrangements: "send the
 * invoice at month end", "book transport on Monday". Grouped by TYPE rather
 * than by customer, because that is how they get used — every transport
 * reminder read together on a Monday morning, rather than opening customers
 * one at a time to find out which need booking.
 *
 * NOT visible to a plain user. RLS returns them nothing at all; this screen
 * is simply where the people who may read them do.
 */
export function SpecificationManager({
  specifications,
  types,
  customers,
}: {
  specifications: CustomerSpecification[];
  types: SpecificationType[];
  customers: Customer[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<CustomerSpecification | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const typeLabel = useTypeLabel();

  const visible = useMemo(
    () =>
      filterByQuery(
        specifications
          .filter((s) => showInactive || s.is_active)
          .filter((s) => (typeFilter ? s.type_id === typeFilter : true)),
        query,
        // Searches the reminder AND the customer, since either is how
        // somebody would go looking for one.
        (s) => `${s.customer?.name ?? ''} ${s.body}`,
      ),
    [specifications, query, typeFilter, showInactive],
  );

  // Grouped by type, in the vocabulary's own order, so Facturación and
  // Transporte always appear in the same place on the screen.
  const grouped = types
    .map((type) => ({ type, rows: visible.filter((s) => s.type_id === type.id) }))
    .filter((g) => g.rows.length > 0);

  const inactiveCount = specifications.filter((s) => !s.is_active).length;

  function toggleActive(spec: CustomerSpecification) {
    startTransition(async () => {
      const res = await setSpecificationActive(spec.id, !spec.is_active);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <PageHeader
        title={t('spec.title')}
        subtitle={t('spec.subtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('spec.new')}
          </Button>
        }
      />

      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <Input
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('spec.search')}
            aria-label={t('spec.search')}
          />
        </div>

        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label={t('spec.typeLabel')}
          className="max-w-[12rem]"
        >
          <option value="">{t('spec.allTypes')}</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {typeLabel(type)}
            </option>
          ))}
        </Select>

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
            {t('spec.showRetired', { count: inactiveCount })}
          </button>
        )}
      </div>

      {grouped.length === 0 ? (
        <EmptyState
          title={specifications.length === 0 ? t('spec.empty') : t('spec.noMatches')}
          body={specifications.length === 0 ? t('spec.emptyBody') : undefined}
          icon={<ClipboardList className="h-5 w-5" aria-hidden />}
          action={
            specifications.length === 0 ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                {t('spec.new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(({ type, rows }) => (
            <section key={type.id}>
              <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
                {typeLabel(type)}
                <span className="text-[12px] font-normal text-subtle">{rows.length}</span>
              </h2>

              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {rows.map((spec) => (
                    <li key={spec.id} className="flex items-start gap-3 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'truncate text-[13.5px] font-medium',
                            !spec.is_active && 'text-muted line-through',
                          )}
                        >
                          {spec.customer?.name ?? '—'}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-muted">
                          {spec.body}
                        </p>
                      </div>

                      {!spec.is_active && (
                        <Badge tone="neutral" className="shrink-0">
                          {t('spec.retired')}
                        </Badge>
                      )}

                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('common.edit')}
                        onClick={() => setEditing(spec)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => toggleActive(spec)}
                      >
                        {t(spec.is_active ? 'spec.retire' : 'spec.restore')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <SpecificationDialog
          key={editing?.id ?? 'new'}
          specification={editing}
          types={types}
          customers={customers}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );
}

/**
 * A type's label.
 *
 * The slug keys the dictionary and `name` is the fallback, so a kind added
 * later that no dictionary knows about still renders readably.
 */
function useTypeLabel() {
  const { t } = useI18n();
  return (type: SpecificationType) => {
    const key = `spec.type.${type.slug}` as MessageKey;
    const translated = t(key);
    return translated === key ? type.name : translated;
  };
}

function SpecificationDialog({
  specification,
  types,
  customers,
  onClose,
}: {
  specification: CustomerSpecification | null;
  types: SpecificationType[];
  customers: Customer[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const typeLabel = useTypeLabel();

  const [customerId, setCustomerId] = useState<string | null>(
    specification?.customer_id ?? null,
  );
  const [typeId, setTypeId] = useState(specification?.type_id ?? types[0]?.id ?? '');
  const [body, setBody] = useState(specification?.body ?? '');
  const [isActive, setIsActive] = useState(specification?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = customerId !== null && typeId !== '' && body.trim().length > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title={specification ? t('spec.edit') : t('spec.new')}
      description={t('spec.dialogHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!ready}
            onClick={() =>
              startTransition(async () => {
                const res = await saveCustomerSpecification(
                  {
                    customer_id: customerId!,
                    type_id: typeId,
                    body: body.trim(),
                    is_active: isActive,
                  },
                  specification?.id,
                );
                if (!res.ok) setError(res.error);
                else {
                  onClose();
                  router.refresh();
                }
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('orders.customer')} required>
          <Combobox
            items={customers.filter(
              (c) => c.is_active || c.id === specification?.customer_id,
            )}
            value={customerId}
            onChange={setCustomerId}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => `${c.company_name} ${c.company_name_addition ?? ''}`}
            placeholder={t('orders.customer')}
          />
        </Field>

        <Field label={t('spec.typeLabel')} required>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {typeLabel(type)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('spec.body')} hint={t('spec.bodyHint')} required>
          <Textarea
            value={body}
            maxLength={1000}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('spec.bodyPlaceholder')}
            autoFocus
          />
        </Field>

        <Checkbox
          label={t('status.active')}
          hint={t('spec.activeHint')}
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />

        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
