'use client';

import { useI18n } from '@/i18n';
import { localizedName } from '@/lib/localized-content';
import type { ProspectListEntry, ProspectStage } from '@/types/sales';

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
      case 'next_step_required':
      case 'prospects_open_has_next_step': return t('sales.errNextStep');
      case 'owner_required': return t('sales.errOwner');
      case 'owner_not_sales': return t('sales.errOwnerNotSales');
      case 'prospect_closed': return t('sales.errClosed');
      case 'not_authorized': return t('hr.errNotAuthorized');
      default: return error;
    }
  };
}

/** The next step with its date: red when overdue, highlighted today. */
export function NextStep({ step, on, today }: { step: string | null; on: string | null; today: string }) {
  const { t, formatDate } = useI18n();
  if (!step || !on) return null;
  const overdue = on < today;
  const isToday = on === today;
  return (
    <span className="block truncate text-[12px]">
      <span className={overdue ? 'font-semibold text-late' : isToday ? 'font-semibold text-accent' : 'text-muted'}>
        {overdue ? `${t('sales.overdue')} · ` : ''}
        {isToday ? t('common.today') : formatDate(on, 'weekday')}
      </span>
      <span className="text-muted"> · {step}</span>
    </span>
  );
}
