'use client';

import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/primitives';
import { localizedName } from '@/lib/localized-content';
import type { EventListEntry, EventRow, EventStage } from '@/types/events';

/* What the events screens share: stage labels, list names, error texts, dates. */

const STAGE_TONE = { idea: 'neutral', confirmed: 'accent', done: 'done', cancelled: 'skipped' } as const;

export function StageBadge({ stage }: { stage: EventStage }) {
  const labels = useEventLabels();
  return <Badge tone={STAGE_TONE[stage]}>{labels.stage(stage)}</Badge>;
}

export function useEventLabels() {
  const { t, locale, formatDate } = useI18n();
  return {
    stage: (s: EventStage) =>
      ({ idea: t('event.stageIdea'), confirmed: t('event.stageConfirmed'), done: t('event.stageDone'), cancelled: t('event.stageCancelled') })[s],
    entry: (list: EventListEntry[], id: string | null) => {
      const e = list.find((x) => x.id === id);
      return e ? localizedName(e, locale) : '—';
    },
    /** 12.10.2026, or 12.10.2026 – 14.10.2026 for more than a day. */
    dates: (e: Pick<EventRow, 'start_date' | 'end_date'>) =>
      e.start_date === e.end_date
        ? formatDate(e.start_date, 'weekday')
        : `${formatDate(e.start_date, 'weekday')} – ${formatDate(e.end_date, 'weekday')}`,
    place: (e: Pick<EventRow, 'place_name' | 'street' | 'postal_code' | 'city'>) =>
      [e.place_name, e.street, [e.postal_code, e.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    error: (code: string) => {
      switch (code) {
        case 'not_authorized': return t('event.errNotAuthorized');
        case 'owner_not_sales':
        case 'salesperson_not_sales': return t('event.errOwnerNotSales');
        case 'owner_required': return t('event.errOwnerRequired');
        case 'event_not_idea': return t('event.errNotIdea');
        case 'events_dates': return t('event.errDates');
        case 'events_cancel_reason': return t('event.errCancelReason');
        case 'event_shifts_times': return t('event.errShiftTimes');
        case 'event_closed': return t('event.errClosed');
        case 'event_order_ready': return t('event.errOrderReady');
        case 'event_order_shipped': return t('event.errOrderShipped');
        case 'duplicate_product': return t('event.errDuplicateProduct');
        case 'invalid_quantity': return t('event.errQuantity');
        case 'invalid_delivery': return t('event.errDelivery');
        default: return code;
      }
    },
  };
}

/** CHF 1'250.00 */
export function chf(amount: number | null): string {
  if (amount === null) return '—';
  return `CHF ${new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}
