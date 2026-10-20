'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, ErrorState, Input } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { setCustomerPrepay, setCustomerPrepayFirstOrders } from '@/server/collection-actions';
import type { PrepayFirstOrders } from '@/types/collections';
import { useCollectionLabels } from './collection-parts';

/**
 * Customers who must pay before delivery. Only a warning elsewhere — on a new
 * order, before shipping, and in Sales — never a block.
 */
export function PrepayList({
  prepay,
  prepayFirst,
  customers,
}: {
  prepay: { id: string; name: string; since: string | null }[];
  prepayFirst: PrepayFirstOrders[];
  customers: { id: string; name: string }[];
}) {
  return (
    <div className="space-y-6">
      <AlwaysList prepay={prepay} customers={customers} />
      <FirstOrdersList rows={prepayFirst} customers={customers} />
    </div>
  );
}

function AlwaysList({
  prepay,
  customers,
}: {
  prepay: { id: string; name: string; since: string | null }[];
  customers: { id: string; name: string }[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useCollectionLabels();
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listed = new Set(prepay.map((c) => c.id));

  function set(customerId: string, on: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setCustomerPrepay(customerId, on);
      if (!res.ok) return setError(labels.error(res.error));
      setAdding(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">{t('collection.prepayHint')}</p>
      {error && <ErrorState message={error} />}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            id="prepay-customer"
            items={customers.filter((c) => !listed.has(c.id))}
            value={adding}
            onChange={setAdding}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => c.name}
          />
        </div>
        <Button size="sm" variant="primary" disabled={!adding} loading={pending} onClick={() => adding && set(adding, true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('collection.prepayAdd')}
        </Button>
      </div>
      {prepay.length === 0 ? (
        <EmptyState title={t('collection.prepayNone')} />
      ) : (
        <Card className="divide-y divide-border">
          {prepay.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <Link href={`/sales/customers/${c.id}`} className="text-[13.5px] font-medium hover:underline">{c.name}</Link>
                {c.since && <p className="text-[12px] text-muted">{t('collection.prepaySince', { date: formatDate(c.since, 'short') })}</p>}
              </div>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => set(c.id, false)}>
                <X className="h-3.5 w-3.5" aria-hidden />
                {t('collection.prepayRemove')}
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/**
 * Customers whose first N orders are paid in advance. The number is set when
 * the customer is created; here the team changes it or sets it later. Orders
 * count as they are created (sale orders, cancelled ones not counted).
 */
function FirstOrdersList({ rows, customers }: { rows: PrepayFirstOrders[]; customers: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useCollectionLabels();
  const [adding, setAdding] = useState<string | null>(null);
  const [addCount, setAddCount] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listed = new Set(rows.map((c) => c.id));
  const digits = (v: string) => v.replace(/D/g, '').slice(0, 2);

  function set(customerId: string, count: number) {
    setError(null);
    startTransition(async () => {
      const res = await setCustomerPrepayFirstOrders(customerId, count);
      if (!res.ok) return setError(res.error === 'invalid_count' ? t('collection.prepayFirstInvalid') : labels.error(res.error));
      setAdding(null);
      setAddCount('');
      setCounts((cur) => {
        const next = { ...cur };
        delete next[customerId];
        return next;
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[14px] font-semibold">{t('collection.prepayFirstTitle')}</h2>
        <p className="text-[12.5px] text-muted">{t('collection.prepayFirstHint')}</p>
      </div>
      {error && <ErrorState message={error} />}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            id="prepay-first-customer"
            items={customers.filter((c) => !listed.has(c.id))}
            value={adding}
            onChange={setAdding}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => c.name}
          />
        </div>
        <Input
          aria-label={t('collection.prepayFirstCount')}
          value={addCount}
          onChange={(e) => setAddCount(digits(e.target.value))}
          inputMode="numeric"
          placeholder="3"
          className="w-16"
        />
        <Button size="sm" variant="primary" disabled={!adding || !Number(addCount)} loading={pending} onClick={() => adding && set(adding, Number(addCount))}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('collection.prepayAdd')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t('collection.prepayFirstNone')} />
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((c) => {
            const draft = counts[c.id];
            const changed = draft !== undefined && Number(draft) !== c.first;
            return (
              <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/sales/customers/${c.id}`} className="text-[13.5px] font-medium hover:underline">{c.name}</Link>
                  <p className="text-[12px] text-muted">
                    {c.counted >= c.first
                      ? t('collection.prepayFirstDone', { of: c.first })
                      : t('collection.prepayFirstProgress', { counted: c.counted, of: c.first })}
                  </p>
                </div>
                <Input
                  aria-label={t('collection.prepayFirstCount')}
                  value={draft ?? String(c.first)}
                  onChange={(e) => setCounts((cur) => ({ ...cur, [c.id]: digits(e.target.value) }))}
                  inputMode="numeric"
                  className="w-16"
                />
                {changed && Number(draft) > 0 && (
                  <Button size="sm" variant="primary" loading={pending} onClick={() => set(c.id, Number(draft))}>
                    {t('common.save')}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => set(c.id, 0)}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                  {t('collection.prepayRemove')}
                </Button>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
