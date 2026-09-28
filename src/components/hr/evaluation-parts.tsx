'use client';

import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/primitives';
import type { HrEvalRequest } from '@/types/hr';

/* Pieces shared by the evaluation screens: sending, the overview, answering. */

export function useEvalError() {
  const { t } = useI18n();
  return (error: string) => {
    switch (error) {
      case 'not_authorized': return t('hr.errNotAuthorized');
      case 'deadline_past': return t('hrEval.errDeadlinePast');
      case 'evaluation_closed': return t('hrEval.errClosed');
      case 'already_submitted': return t('hrEval.errSubmitted');
      case 'rate_all': return t('hrEval.errRateAll');
      case 'evaluators_required': return t('hrEval.errEvaluators');
      case 'items_required': return t('hrEval.errItems');
      default: return error;
    }
  };
}

/** 1 = Muy en desacuerdo … 5 = Totalmente de acuerdo, as in the file's evaluations. */
export function useScaleLabels() {
  const { t } = useI18n();
  return [t('hr.scale1'), t('hr.scale2'), t('hr.scale3'), t('hr.scale4'), t('hr.scale5')];
}

export function ScaleInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number | null;
  onChange: (n: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const scale = useScaleLabels();
  return (
    <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={cn(
            'h-9 w-9 rounded-lg border text-[13px] font-medium tabular transition-colors disabled:opacity-60',
            value === n ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-surface hover:bg-surface-2',
          )}
        >
          {n}
        </button>
      ))}
      {value && <span className="self-center text-[12px] text-muted">{scale[value - 1]}</span>}
    </div>
  );
}

/** Open until a date, or closed — early or at its deadline. */
export function RequestStatus({ request }: { request: Pick<HrEvalRequest, 'open' | 'deadline' | 'closed_at'> }) {
  const { t, formatDate } = useI18n();
  if (request.open) {
    return <Badge tone="accent">{t('hrEval.open')} · {t('hrEval.until', { date: formatDate(request.deadline, 'medium') })}</Badge>;
  }
  return (
    <Badge tone="neutral">
      {request.closed_at
        ? t('hrEval.closedOn', { date: formatDate(request.closed_at, 'medium') })
        : `${t('hrEval.closed')} · ${formatDate(request.deadline, 'medium')}`}
    </Badge>
  );
}
