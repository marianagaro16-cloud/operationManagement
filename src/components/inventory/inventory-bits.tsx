'use client';

import { Clock } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/primitives';
import { formatCalendarWeek } from '@/domain/inventory/schedule';
import type { InventoryStatus } from '@/types/inventory';

/**
 * Small shared pieces of the inventory UI.
 *
 * Kept together because the status vocabulary and the Pending treatment have
 * to look identical on the overview, the detail screen and the admin reports —
 * three places where a divergent rendering of "Pending" would be read as a
 * different state.
 */

const STATUS_TONE = {
  in_progress: 'accent',
  completed: 'done',
  to_review: 'late',
  resolved: 'skipped',
} as const satisfies Record<InventoryStatus, 'accent' | 'done' | 'late' | 'skipped'>;

const STATUS_KEY = {
  in_progress: 'inventory.statusInProgress',
  completed: 'inventory.statusCompleted',
  to_review: 'inventory.statusToReview',
  resolved: 'inventory.statusResolved',
} as const satisfies Record<InventoryStatus, MessageKey>;

export function StatusBadge({ status }: { status: InventoryStatus }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]}>{t(STATUS_KEY[status])}</Badge>;
}

/**
 * "Inventory Digital: Pending".
 *
 * Deliberately its own badge rather than a fifth status: it can coexist with
 * any status, and it is the signal that an ADMIN still owes an action — not
 * that the counter did something wrong.
 */
export function DigitalPendingBadge({ count }: { count?: number }) {
  const { t } = useI18n();
  return (
    <Badge tone="warn" className="whitespace-nowrap">
      <Clock className="h-3 w-3" aria-hidden />
      {count === undefined
        ? t('inventory.digitalPending')
        : t('inventory.pendingCount', { count })}
    </Badge>
  );
}

export function WeekBadge({ isoWeek }: { isoWeek: number }) {
  return <Badge tone="neutral">{formatCalendarWeek(isoWeek)}</Badge>;
}

/**
 * The difference, rendered so the sign carries the meaning at a glance.
 * A null difference is never shown as 0 — it becomes the Pending badge.
 */
export function DifferenceValue({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}) {
  const { t } = useI18n();
  if (value === null) {
    return <span className={cn('text-[13px] text-muted', className)}>{t('inventory.notSet')}</span>;
  }
  return (
    <span
      className={cn(
        'tabular-nums font-semibold',
        value === 0 ? 'text-done' : 'text-late',
        className,
      )}
    >
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

/** Maps a server action error code to a translated sentence. */
export function useInventoryError() {
  const { t } = useI18n();
  return (code?: string): string => {
    switch (code) {
      case 'not_authorized':
        return t('inventory.errNotAuthorized');
      case 'not_an_integer':
        return t('inventory.errNotInteger');
      case 'negative_quantity':
        return t('inventory.errNegative');
      case 'digital_disabled_for_template':
        return t('inventory.errDigitalDisabled');
      case 'resolution_note_required':
        return t('inventory.resolutionRequired');
      case 'nothing_to_resolve':
        return t('inventory.errNothingToResolve');
      case 'inventory_already_completed':
        return t('inventory.errAlreadyCompleted');
      case 'location_required':
      case 'location_not_found':
        return t('inventory.errLocationRequired');
      case 'invalid_window':
        return t('inventory.errGrantWindow');
      case 'grant_spans_multiple_days':
        return t('inventory.grantSingleDay');
      default:
        return code ?? t('common.error');
    }
  };
}

/** Compact list of assignee initials, or an explicit "nobody" state. */
export function AssigneeList({
  people,
}: {
  people: { id: string; name: string | null; email: string }[];
}) {
  const { t } = useI18n();
  if (people.length === 0) {
    return <span className="text-[12px] text-subtle">{t('inventory.unassigned')}</span>;
  }
  return (
    <span className="truncate text-[12px] text-muted">
      {people.map((p) => p.name?.split(' ')[0] ?? p.email).join(', ')}
    </span>
  );
}
