'use client';

import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/primitives';
import type { CollectionStage } from '@/types/collections';

/* What the collections screens share. */

const TONE: Record<CollectionStage, 'warn' | 'accent' | 'done' | 'late' | 'skipped' | 'neutral'> = {
  reminders: 'neutral',
  follow_up: 'warn',
  promise: 'accent',
  paid: 'done',
  agency: 'late',
  paid_agency: 'done',
  uncollectible: 'skipped',
};

export function StageBadge({ stage, reminders = 0 }: { stage: CollectionStage; reminders?: number }) {
  const { t } = useI18n();
  const labels = useCollectionLabels();
  return <Badge tone={TONE[stage]}>{stage === 'reminders' ? t('collection.stageReminder', { n: reminders }) : labels.stage(stage)}</Badge>;
}

/** CHF 1'250.00 */
export function chf(n: number): string {
  return `CHF ${new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function useCollectionLabels() {
  const { t } = useI18n();
  return {
    stage: (s: CollectionStage) =>
      ({
        reminders: t('collection.stageReminders'),
        follow_up: t('collection.stageFollowUp'),
        promise: t('collection.stagePromise'),
        paid: t('collection.stagePaid'),
        agency: t('collection.stageAgency'),
        paid_agency: t('collection.stagePaidAgency'),
        uncollectible: t('collection.stageUncollectible'),
      })[s],
    error: (code: string) => {
      // "invoice_exists|RE-07570|El Catrín": which invoice, and whose case has it.
      const [kind, number = '', customer = ''] = code.split('|');
      if (kind === 'invoice_exists') return t('collection.errInvoiceExists', { number, customer });
      if (kind === 'invoice_twice') return t('collection.errInvoiceTwice', { number });
      switch (code) {
        case 'not_authorized': return t('collection.errNotAuthorized');
        case 'responsible_not_team': return t('collection.errResponsible');
        case 'invoice_required': return t('collection.errInvoice');
        case 'invalid_amount': return t('collection.errAmount');
        case 'body_required': return t('collection.errBody');
        default: return code;
      }
    },
  };
}
