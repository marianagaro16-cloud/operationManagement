'use client';

import { useI18n } from '@/i18n';
import { localizedName } from '@/lib/localized-content';
import { AlertTriangle } from 'lucide-react';
import { KindIcon, useKinds } from './activity-kind';
import { timeRange } from '@/domain/sales/times';
import type { ActivityKind, Prospect, ProspectListEntry, ProspectStage } from '@/types/sales';

/* Names for the prospect vocabulary, and the next step's urgency. */

const STAGE_KEY = {
  new: 'sales.stageNew',
  contacted: 'sales.stageContacted',
  tasting: 'sales.stageTasting',
  offer: 'sales.stageOffer',
  won: 'sales.stageWon',
  lost: 'sales.stageLost',
} as const;

export function useProspectLabels() {
  const { t, locale } = useI18n();
  return {
    stage: (s: ProspectStage) => t(STAGE_KEY[s]),
    /** An entry of Admin's lists by id, in the reader's language; null when unset. */
    entry: (list: ProspectListEntry[], id: string | null) => {
      const found = id ? list.find((e) => e.id === id) : undefined;
      return found ? localizedName(found, locale) : null;
    },
  };
}

export function useProspectError() {
  const { t } = useI18n();
  return (error: string) => {
    switch (error) {
      case 'first_activity_required': return t('sales.errFirstActivity');
      case 'owner_required': return t('sales.errOwner');
      case 'owner_not_sales': return t('sales.errOwnerNotSales');
      case 'prospect_closed': return t('sales.errClosed');
      case 'not_authorized': return t('hr.errNotAuthorized');
      default: return error;
    }
  };
}

/**
 * A prospect's next planned activity: red when overdue, highlighted today,
 * and a warning when nothing is planned — every open prospect needs something.
 */
export function NextPlanned({
  next,
  kinds,
  today,
}: {
  next: Prospect['next'];
  kinds: ActivityKind[];
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const k = useKinds(kinds);
  if (!next) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-late">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {t('sales.planNothing')}
      </span>
    );
  }
  const overdue = next.date < today;
  const isToday = next.date === today;
  const kind = k.get(next.kind_id);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
      {kind && <KindIcon icon={kind.icon} className="h-3 w-3 shrink-0 text-accent" />}
      <span className={overdue ? 'font-semibold text-late' : isToday ? 'font-semibold text-accent' : 'text-muted'}>
        {overdue ? `${t('sales.overdue')} · ` : ''}
        {isToday ? t('common.today') : formatDate(next.date, 'weekday')}
        {next.time && ` ${timeRange(next.time, next.end)}`}
      </span>
      <span className="truncate text-muted">· {k.name(next.kind_id)}{next.title ? ` · ${next.title}` : ''}</span>
    </span>
  );
}
