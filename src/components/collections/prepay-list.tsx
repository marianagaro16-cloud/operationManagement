'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { setCustomerPrepay } from '@/server/collection-actions';
import { useCollectionLabels } from './collection-parts';

/**
 * Customers who must pay before delivery. Only a warning elsewhere — on a new
 * order, before shipping, and in Sales — never a block.
 */
export function PrepayList({
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
