'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Hand, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { deleteMerchHandout } from '@/server/merch-actions';
import type { MerchHistoryEntry } from '@/types/merch';
import { MerchStatusBadge, useMerchLabels } from './merch-parts';

/**
 * Merch history rows — what went out with which order, or was handed over in
 * person. `show` picks the column that varies: the item (a customer's file)
 * or the customer (an item's page).
 */
export function MerchHistoryList({
  entries,
  show,
  customerLinks = false,
  canRemove = false,
}: {
  entries: MerchHistoryEntry[];
  show: 'item' | 'customer';
  customerLinks?: boolean;
  /** Hand-overs can be taken back by the planners. */
  canRemove?: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useMerchLabels();
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li key={`${e.source}-${e.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[12.5px]">
            <span className="w-16 shrink-0 tabular text-muted">{formatDate(e.date, 'short')}</span>
            <span className="min-w-0 flex-1">
              {show === 'item' ? (
                <span className="font-medium">{e.item_name}</span>
              ) : customerLinks ? (
                <Link href={`/sales/customers/${e.customer_id}`} className="font-medium hover:text-accent">{e.customer_name}</Link>
              ) : (
                <span className="font-medium">{e.customer_name}</span>
              )}
              <span className="ml-1.5 tabular text-muted">×{e.quantity}</span>
              {e.source === 'handout' && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-muted">
                  <Hand className="h-3 w-3" aria-hidden />
                  {t('merch.giveInPerson')}
                  {e.by && ` · ${e.by}`}
                </span>
              )}
              {e.status === 'not_sent' && (
                <span className="ml-1.5 text-warn">{labels.reason(e.not_sent_reason)}</span>
              )}
              {e.note && <span className="block truncate text-muted">{e.note}</span>}
            </span>
            {e.order && (
              <Link href={`/orders/${e.order.id}`} className="tabular text-accent hover:underline">
                {t('merch.order', { reference: e.order.reference })}
              </Link>
            )}
            {e.campaign_id && (
              <Link href={`/merch/${e.campaign_id}`} className="text-muted hover:text-accent hover:underline">
                {t('merch.tabCampaigns')}
              </Link>
            )}
            {e.source === 'campaign' && <MerchStatusBadge status={e.status} />}
            {e.source === 'handout' && canRemove && (
              <Button size="sm" variant="ghost" onClick={() => setRemoving(e.id)} aria-label={t('merch.removeHandout')}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          startTransition(async () => {
            if (removing) await deleteMerchHandout(removing);
            setRemoving(null);
            router.refresh();
          })
        }
        title={t('merch.removeHandout')}
        message={t('merch.removeHandoutConfirm')}
        confirmLabel={t('merch.removeHandout')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
    </>
  );
}
