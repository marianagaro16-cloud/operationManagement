'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { useCustomerTypeLabel } from '@/components/customers/use-customer-type-label';
import { cancelMerchCampaign } from '@/server/merch-actions';
import { merchSettled } from '@/domain/merch';
import type { CustomerType } from '@/types/orders';
import type { MerchCampaignLine, MerchCampaignRow, MerchCustomerOption, MerchItemRow, MerchLineStatus } from '@/types/merch';
import { CampaignDialog } from './campaign-dialog';
import { MerchStatusBadge, useMerchLabels } from './merch-parts';

/** The order customers are listed in: what still needs something first. */
const ORDER: MerchLineStatus[] = ['waiting', 'on_order', 'packed', 'not_sent', 'expired', 'sent'];

/** One campaign: what it is, and where each customer's merch stands. */
export function CampaignView({
  campaign,
  lines,
  items,
  customers,
  types,
  today,
  customerLinks = false,
}: {
  /** The customer file is Sales': linked only for whoever can open it. */
  customerLinks?: boolean;
  campaign: MerchCampaignRow;
  lines: MerchCampaignLine[];
  items: MerchItemRow[];
  customers: MerchCustomerOption[];
  types: CustomerType[];
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useMerchLabels();
  const typeLabel = useCustomerTypeLabel();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cancelled = Boolean(campaign.cancelled_at);

  const sorted = [...lines].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.customer_name.localeCompare(b.customer_name));
  const ownPromised = lines.filter((l) => !merchSettled(l.status)).reduce((s, l) => s + l.quantity, 0);
  const typeNames = campaign.customer_type_ids
    .map((id) => types.find((ty) => ty.id === id))
    .filter((ty): ty is CustomerType => !!ty)
    .map((ty) => typeLabel(ty));

  return (
    <>
      <Link href="/merch" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('merch.navLabel')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold leading-tight">{campaign.item_name}</h1>
              {cancelled && <Badge tone="neutral">{t('merch.cancelled')}</Badge>}
            </div>
            <p className="mt-1 text-[12.5px] text-muted">
              {t('merch.weekOf', { date: formatDate(campaign.week_start, 'medium') })} · {t('merch.until', { date: formatDate(campaign.deadline, 'medium') })}
              {' · '}{t('merch.perCustomerShort', { quantity: campaign.quantity })}
            </p>
            {typeNames.length > 0 && <p className="text-[12.5px] text-muted">{t('merch.types')}: {typeNames.join(', ')}</p>}
            {campaign.creator_name && <p className="text-[12px] text-subtle">{t('merch.by', { name: campaign.creator_name })}</p>}
          </div>
          {!cancelled && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                {t('common.edit')}
              </Button>
              <Button size="sm" variant="ghost" className="text-late hover:bg-late/10 hover:text-late" onClick={() => setCancelling(true)}>
                {t('merch.cancelCampaign')}
              </Button>
            </div>
          )}
        </div>
        {campaign.note && <div className="mt-2 text-[13px]"><NoteText text={campaign.note} /></div>}
        <p className="mt-2 flex flex-wrap gap-x-3 text-[12px] tabular">
          <span className="text-done">{t('merch.countSent', { count: campaign.counts.sent })}</span>
          <span className="text-accent">{t('merch.countOnOrder', { count: campaign.counts.on_order + campaign.counts.packed })}</span>
          <span className="text-muted">{t('merch.countWaiting', { count: campaign.counts.waiting })}</span>
          <span className="text-warn">{t('merch.countNotSent', { count: campaign.counts.not_sent + campaign.counts.expired })}</span>
        </p>
        {error && <p className="mt-2 text-[12.5px] text-late">{error}</p>}
      </Card>

      {sorted.length === 0 ? (
        <EmptyState title={t('merch.noHistory')} />
      ) : (
        <Card className="divide-y divide-border">
          {sorted.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
              <div className="min-w-0 flex-1">
                {customerLinks ? (
                  <Link href={`/sales/customers/${l.customer_id}`} className="text-[13px] font-medium hover:text-accent">{l.customer_name}</Link>
                ) : (
                  <span className="text-[13px] font-medium">{l.customer_name}</span>
                )}
                {l.status === 'not_sent' && (
                  <p className="text-[12px] text-warn">{labels.reason(l.not_sent_reason)}{l.not_sent_note ? ` — ${l.not_sent_note}` : ''}</p>
                )}
              </div>
              <span className="text-[12.5px] tabular text-muted">×{l.quantity}</span>
              {l.order && (
                <Link href={`/orders/${l.order.id}`} className="text-[12px] tabular text-accent hover:underline">
                  #{l.order.reference} · {formatDate(l.order.delivery_date, 'short')}
                </Link>
              )}
              <MerchStatusBadge status={l.status} />
            </div>
          ))}
        </Card>
      )}

      {editing && (
        <CampaignDialog
          campaign={campaign}
          currentCustomerIds={lines.map((l) => l.customer_id)}
          ownPromised={ownPromised}
          items={items}
          customers={customers}
          types={types}
          today={today}
          onClose={() => setEditing(false)}
        />
      )}
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={() =>
          startTransition(async () => {
            const res = await cancelMerchCampaign(campaign.id);
            setCancelling(false);
            if (!res.ok) return setError(labels.error(res.error));
            router.refresh();
          })
        }
        title={t('merch.cancelCampaign')}
        message={t('merch.cancelConfirm')}
        confirmLabel={t('merch.cancelCampaign')}
        cancelLabel={t('common.back')}
        destructive
        loading={pending}
      />
    </>
  );
}
