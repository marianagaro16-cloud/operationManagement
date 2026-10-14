'use client';

import Link from 'next/link';
import { useI18n, type MessageKey } from '@/i18n';
import { Badge, type Tone } from '@/components/ui/primitives';
import type { MerchLineStatus, MerchNotSentReason } from '@/types/merch';

const TONE: Record<MerchLineStatus, Tone> = {
  waiting: 'neutral',
  on_order: 'accent',
  packed: 'accent',
  sent: 'done',
  not_sent: 'warn',
  expired: 'late',
};

export function MerchStatusBadge({ status }: { status: MerchLineStatus }) {
  const { t } = useI18n();
  return <Badge tone={TONE[status]}>{t(`merch.status_${status}` as MessageKey)}</Badge>;
}

export function useMerchLabels() {
  const { t } = useI18n();
  return {
    reason: (r: MerchNotSentReason | null) => (r ? t(`merch.reason_${r}` as MessageKey) : ''),
    error: (code: string) => {
      const map: Record<string, MessageKey> = {
        merch_no_customers: 'merch.errNoCustomers',
        merch_item_inactive: 'merch.errItemInactive',
        merch_items_name_key: 'merch.errNameTaken',
        merch_invalid_quantity: 'merch.errQuantity',
        merch_reason_required: 'merch.errReason',
        not_authorized: 'orders.errFulfilmentNotAuthorized',
      };
      return map[code] ? t(map[code]) : t('common.error');
    },
  };
}

/** The tabs of the Merch section. */
export function MerchTabs({ tab }: { tab: 'campaigns' | 'items' }) {
  const { t } = useI18n();
  return (
    <div className="-mt-2 mb-3 flex flex-wrap items-center gap-1 border-b border-border">
      {(['campaigns', 'items'] as const).map((key) => (
        <Link
          key={key}
          href={`/merch?tab=${key}`}
          scroll={false}
          className={
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ' +
            (tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')
          }
        >
          {key === 'campaigns' ? t('merch.tabCampaigns') : t('merch.tabItems')}
        </Link>
      ))}
    </div>
  );
}
