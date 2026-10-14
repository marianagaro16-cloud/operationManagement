'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, Gift, RotateCcw } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn, displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/primitives';
import { setMerchPacking, setMerchQuantity } from '@/server/merch-actions';
import { MERCH_REASONS, type MerchNotSentReason, type OrderMerchLine } from '@/types/merch';
import type { Order } from '@/types/orders';

const ERRORS: Record<string, MessageKey> = {
  order_ready_locked: 'orders.errReadyLocked',
  order_shipped_locked: 'orders.errShippedLocked',
  merch_reason_required: 'merch.errReason',
  merch_invalid_quantity: 'merch.errQuantity',
};

export function useMerchError() {
  const { t } = useI18n();
  return (code: string) => (ERRORS[code] ? t(ERRORS[code]) : t('common.error'));
}

/**
 * "Merch to include" on an order: what a campaign put on it.
 *
 * Whoever packs ticks each item as packed, or marks it not sent with a
 * reason; Ready waits until every one is decided. Frozen once Ready, like the
 * lots. The quantity can be changed by the planners and whoever manages
 * orders, until then.
 */
export function OrderMerch({
  order,
  canPack,
  canEditQuantity = false,
  className,
}: {
  order: Pick<Order, 'merch' | 'ready_at' | 'shipped_at' | 'status'>;
  /** May tick packed / not sent: whoever prepares, where they prepare. */
  canPack: boolean;
  canEditQuantity?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const lines = [...(order.merch ?? [])].sort((a, b) =>
    (a.campaign?.item?.name ?? '').localeCompare(b.campaign?.item?.name ?? ''),
  );
  if (lines.length === 0) return null;
  const locked = Boolean(order.ready_at) || Boolean(order.shipped_at) || order.status === 'cancelled';

  return (
    <div className={className}>
      <p className="flex items-center gap-1.5 border-y border-border bg-surface-2/40 px-3.5 py-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
        <Gift className="h-3 w-3" aria-hidden />
        {t('merch.onOrderTitle')}
      </p>
      <ul className="divide-y divide-border">
        {lines.map((line) => (
          <MerchLine key={line.id} line={line} canPack={canPack && !locked} canEditQuantity={canEditQuantity && !locked} />
        ))}
      </ul>
    </div>
  );
}

function MerchLine({ line, canPack, canEditQuantity }: { line: OrderMerchLine; canPack: boolean; canEditQuantity: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const translate = useMerchError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<MerchNotSentReason | ''>('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(String(line.quantity));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(translate(res.error ?? ''));
      after?.();
      router.refresh();
    });
  }

  function notSent() {
    if (!reason) return setError(t('merch.errReason'));
    if (reason === 'other' && !note.trim()) return setError(t('merch.detailsRequired'));
    run(() => setMerchPacking(line.id, 'not_sent', reason, note.trim() || null), () => setAsking(false));
  }

  function commitQty() {
    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n) || n < 1 || n > 9999) { setQty(String(line.quantity)); return setError(t('merch.errQuantity')); }
    if (n !== line.quantity) run(() => setMerchQuantity(line.id, n));
  }

  return (
    <li className="px-3.5 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-[13px] font-medium', line.packing === 'not_sent' && 'text-muted line-through')}>
            {line.campaign?.item?.name ?? '—'}
            {!canEditQuantity && <span className="ml-1.5 tabular text-muted">×{line.quantity}</span>}
          </p>
          {line.packing === 'packed' && (
            <p className="flex items-center gap-1 text-[11.5px] text-done">
              <Check className="h-3 w-3" aria-hidden />
              {t('merch.packedBy', { name: line.packer ? displayName(line.packer) : '—' })}
            </p>
          )}
          {line.packing === 'not_sent' && (
            <p className="text-[11.5px] text-warn">
              {t('merch.status_not_sent')}: {line.not_sent_reason ? t(`merch.reason_${line.not_sent_reason}` as MessageKey) : ''}
              {line.not_sent_note ? ` — ${line.not_sent_note}` : ''}
            </p>
          )}
        </div>

        {canEditQuantity && (
          <Input
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={commitQty}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            inputMode="numeric"
            disabled={pending}
            aria-label={t('merch.quantity')}
            className="w-16 shrink-0 text-center text-[14px] font-semibold tabular"
          />
        )}

        {canPack && line.packing === 'open' && !asking && (
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="success" loading={pending} onClick={() => run(() => setMerchPacking(line.id, 'packed'))}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              {t('merch.markPacked')}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAsking(true)}>
              <Ban className="h-3.5 w-3.5" aria-hidden />
              {t('merch.markNotSent')}
            </Button>
          </div>
        )}
        {canPack && line.packing !== 'open' && (
          <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => setMerchPacking(line.id, 'open'))}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t('merch.undo')}
          </Button>
        )}
      </div>

      {asking && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Select value={reason} onChange={(e) => setReason(e.target.value as MerchNotSentReason)} aria-label={t('merch.why')} className="max-w-[14rem]">
            <option value="">{t('merch.why')}</option>
            {MERCH_REASONS.map((r) => (
              <option key={r} value={r}>{t(`merch.reason_${r}` as MessageKey)}</option>
            ))}
          </Select>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={reason === 'other' ? t('merch.detailsRequired') : t('merch.details')}
            className="min-w-[10rem] flex-1"
            maxLength={300}
          />
          <Button size="sm" variant="primary" loading={pending} onClick={notSent}>{t('common.save')}</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setAsking(false); setError(null); }}>{t('common.cancel')}</Button>
        </div>
      )}

      {error && <p className="mt-1 text-[12px] text-late">{error}</p>}
    </li>
  );
}

/** True while some merch on the order is neither packed nor marked not sent. */
export function merchOpen(order: Pick<Order, 'merch'>): boolean {
  return (order.merch ?? []).some((m) => m.packing === 'open');
}
