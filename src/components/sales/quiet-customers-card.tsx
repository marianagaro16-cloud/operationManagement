'use client';

import Link from 'next/link';
import { TrendingDown } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui/primitives';
import { QuietRow } from './quiet-customers';
import type { QuietCustomer } from '@/types/sales';

/** How many customers are going quiet, the most overdue first. Nothing when there are none. */
export function QuietCustomersCard({ customers }: { customers: QuietCustomer[] }) {
  const { t } = useI18n();
  if (customers.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <TrendingDown className="h-4 w-4 text-late" aria-hidden />
          {t('sales.tabQuiet')}
          <span className="text-[12px] font-normal tabular text-muted">{customers.length}</span>
        </h2>
        <Link href="/sales?tab=quiet" className="text-[12.5px] font-medium text-accent hover:underline">
          {t('sales.quietSeeAll')}
        </Link>
      </div>
      <Card className="divide-y divide-border">
        {customers.slice(0, 5).map((c) => <QuietRow key={c.id} c={c} compact />)}
      </Card>
    </section>
  );
}
