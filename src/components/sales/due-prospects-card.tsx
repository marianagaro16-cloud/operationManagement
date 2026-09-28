'use client';

import Link from 'next/link';
import { ChevronRight, Target } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui/primitives';
import { NextStep } from './prospect-parts';
import type { Prospect } from '@/types/sales';

/** The viewer's prospects whose next step is today or overdue. Nothing when there are none. */
export function DueProspectsCard({ prospects, today }: { prospects: Prospect[]; today: string }) {
  const { t } = useI18n();
  if (prospects.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Target className="h-4 w-4 text-accent" aria-hidden />
          {t('sales.dueTitle')}
          <span className="text-[12px] font-normal tabular text-muted">{prospects.length}</span>
        </h2>
        <Link href="/sales?tab=prospects" className="text-[12.5px] font-medium text-accent hover:underline">
          {t('sales.dueSeeAll')}
        </Link>
      </div>
      <Card className="divide-y divide-border">
        {prospects.map((p) => (
          <Link
            key={p.id}
            href={`/sales/prospects/${p.id}`}
            className="flex items-center gap-3 px-3.5 py-2 transition-colors hover:bg-surface-2/60"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{p.company_name}</span>
              <NextStep step={p.next_step} on={p.next_step_on} today={today} />
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
          </Link>
        ))}
      </Card>
    </section>
  );
}
