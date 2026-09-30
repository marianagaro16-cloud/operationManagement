'use client';

import { useEffect } from 'react';
import { useI18n } from '@/i18n';
import type { SalesSummary } from '@/types/summaries';
import { SummaryView } from './summary-view';

/** The printable summary: opens the print dialog once it has drawn. */
export function PrintSummary({ summary }: { summary: SalesSummary }) {
  const { t } = useI18n();
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="mx-auto max-w-3xl bg-surface p-6 text-fg print:max-w-none print:p-0">
      <h1 className="text-2xl font-semibold">{summary.title}</h1>
      <p className="mb-4 text-[13px] text-muted">{[summary.author, t('summary.printedFrom')].filter(Boolean).join(' · ')}</p>
      <SummaryView content={summary.content} from={summary.period_from} to={summary.period_to} />
    </main>
  );
}
