'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { addDays } from '@/lib/datetime';
import { formatQuantity, type LineUnit, type StorageType } from '@/domain/goods-reception/expected';
import { productLabel } from '@/types/orders';
import { Badge, Input } from '@/components/ui/primitives';
import type { ExpectedDelivery, ExpectedLine } from '@/types/goods-reception';

/* Small shared pieces of the expected deliveries' screens. */

const KNOWN_ERRORS = new Set([
  'not_authorized',
  'invalid_expected',
  'expected_not_found',
  'expected_not_open',
  'expected_not_arrived',
  'expected_in_past',
  'expected_supplier_mismatch',
  'reception_already_linked',
]);

/** An action's error identifier as a sentence; a reception's own errors fall through to its translator. */
export function useExpectedError() {
  const { t } = useI18n();
  return useCallback((code: string) => (KNOWN_ERRORS.has(code) ? t(`grx.error.${code}` as MessageKey) : code), [t]);
}

export function useExpectedLabels() {
  const { t, formatDate } = useI18n();
  const storage = (value: StorageType) => t(`grx.storageLabel.${value}` as MessageKey);
  const unit = (value: LineUnit) => t(`grx.unitLabel.${value}` as MessageKey);
  const lineName = (line: Pick<ExpectedLine, 'description' | 'product'>) =>
    line.product ? productLabel(line.product) : (line.description ?? '');
  /** "09.10." or "Semana 12.10.–16.10." */
  const when = (d: Pick<ExpectedDelivery, 'expected_date' | 'expected_week'>) =>
    d.expected_date
      ? formatDate(d.expected_date, 'short')
      : t('grx.weekRange', { from: formatDate(d.expected_week!, 'short'), to: formatDate(addDays(d.expected_week!, 4), 'short') });
  const pallets = (count: number) => (count === 1 ? t('grx.onePallet') : t('grx.palletsCount', { count }));
  return { storage, unit, lineName, when, pallets };
}

/** "17 pallets", and where they go. */
export function LoadBadges({ delivery }: { delivery: Pick<ExpectedDelivery, 'pallets' | 'storage'> }) {
  const labels = useExpectedLabels();
  return (
    <>
      {delivery.pallets && <Badge tone="accent">{labels.pallets(delivery.pallets)}</Badge>}
      {delivery.storage.map((s) => (
        <Badge key={s} tone={s === 'dry' ? 'neutral' : 'warn'}>{labels.storage(s)}</Badge>
      ))}
    </>
  );
}

/**
 * The announced lines. With `received`, each has a field for what was
 * counted; without, the counted quantity is shown beside the announced one
 * when there is one.
 */
export function ExpectedLines({
  lines,
  received,
  onReceived,
}: {
  lines: ExpectedLine[];
  /** Line id -> what is typed; present only while comparing. */
  received?: Record<string, string>;
  onReceived?: (lineId: string, value: string) => void;
}) {
  const { t } = useI18n();
  const labels = useExpectedLabels();
  if (lines.length === 0) return null;

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {lines.map((line) => {
        const typed = received?.[line.id];
        const counted = received ? (typed === '' || typed === undefined ? null : Number(typed)) : line.received_quantity === null ? null : Number(line.received_quantity);
        const differs = counted !== null && counted !== Number(line.quantity);
        return (
          <li key={line.id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 text-[13px]">
              <span className="block break-words font-medium">{labels.lineName(line)}</span>
              <span className="block text-[12px] text-muted">
                {t('grx.expectedQty')}: {formatQuantity(line.quantity)} {labels.unit(line.unit)}
              </span>
            </span>
            {received && onReceived ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  aria-label={`${t('grx.receivedQty')}: ${labels.lineName(line)}`}
                  className={cn('w-24 text-right tabular', differs && 'border-late text-late')}
                  value={typed ?? ''}
                  onChange={(e) => onReceived(line.id, e.target.value)}
                />
                <span className="w-12 text-[12px] text-muted">{labels.unit(line.unit)}</span>
              </span>
            ) : counted !== null ? (
              <span className={cn('shrink-0 text-right text-[13px] font-semibold tabular', differs ? 'text-late' : 'text-done')}>
                {formatQuantity(counted)} {labels.unit(line.unit)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What a compare form starts from: the announced quantities the first time —
 * the receiver changes only what differs — and, once something was counted,
 * exactly what was counted, an uncounted line staying empty.
 */
export function initialReceived(lines: ExpectedLine[]): Record<string, string> {
  const counted = lines.some((l) => l.received_quantity !== null);
  return Object.fromEntries(
    lines.map((l) => [l.id, counted ? (l.received_quantity === null ? '' : formatQuantity(l.received_quantity)) : formatQuantity(l.quantity)]),
  );
}

/** The compare form's fields as the action wants them; an empty field is "not counted". */
export function toReceived(lines: ExpectedLine[], typed: Record<string, string>): { id: string; received: number | null }[] {
  return lines.map((l) => {
    const value = typed[l.id];
    const parsed = value === undefined || value.trim() === '' ? null : Number(value);
    return { id: l.id, received: parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null };
  });
}

/** The two halves of Recepción, for whoever sees what is expected. */
export function ReceptionTabs({ tab, expectedCount }: { tab: 'expected' | 'received'; expectedCount: number }) {
  const { t } = useI18n();
  const tabs = [
    { key: 'expected' as const, href: '/goods-reception?tab=expected', label: t('grx.tabExpected'), count: expectedCount },
    { key: 'received' as const, href: '/goods-reception?tab=received', label: t('grx.tabReceived'), count: 0 },
  ];
  return (
    <div className="mb-4 flex gap-1 rounded-lg bg-surface-2 p-1">
      {tabs.map(({ key, href, label, count }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
            tab === key ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          <span className="truncate">{label}</span>
          {count > 0 && <span className="rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold tabular text-accent">{count}</span>}
        </Link>
      ))}
    </div>
  );
}
