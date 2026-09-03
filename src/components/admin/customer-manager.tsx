'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { saveCustomer } from '@/server/order-actions';
import type { Customer } from '@/types/orders';

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
export function CustomerManager({ customers }: { customers: Customer[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const inactiveCount = customers.filter((c) => !c.is_active).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (!showInactive && !c.is_active) return false;
      if (!q) return true;
      // Search covers BOTH fields, since the team may know either.
      return (
        c.company_name.toLowerCase().includes(q) ||
        (c.company_name_addition ?? '').toLowerCase().includes(q)
      );
    });
  }, [customers, query, showInactive]);

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
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function CustomerDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [companyName, setCompanyName] = useState(customer?.company_name ?? '');
  const [addition, setAddition] = useState(customer?.company_name_addition ?? '');
  const [active, setActive] = useState(customer?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveCustomer(
        { company_name: companyName, company_name_addition: addition || null, is_active: active },
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
