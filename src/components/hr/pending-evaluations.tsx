'use client';

import { ClipboardCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { EvaluationRow } from './my-evaluation';
import type { MyEvaluation } from '@/server/hr-evaluations';

/** Evaluations the viewer still has to fill in. Nothing at all when there are none. */
export function PendingEvaluations({ evaluations }: { evaluations: MyEvaluation[] }) {
  const { t } = useI18n();
  if (evaluations.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold">
        <ClipboardCheck className="h-4 w-4 text-accent" aria-hidden />
        {t('hrEval.pendingTitle')}
        <span className="text-[12px] font-normal tabular text-muted">{evaluations.length}</span>
      </h2>
      <ul className="space-y-2">
        {evaluations.map((e) => (
          <li key={e.assignment.id}>
            <EvaluationRow evaluation={e} />
          </li>
        ))}
      </ul>
    </section>
  );
}
