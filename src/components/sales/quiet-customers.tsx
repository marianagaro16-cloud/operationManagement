'use client';

import Link from 'next/link';
import { ChevronRight, TrendingDown } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import type { QuietCustomer } from '@/types/sales';

const number = (n: number, digits = 0) =>
  new Intl.NumberFormat('de-CH', { maximumFractionDigits: digits }).format(Number(n));

/** Why a customer is on the list: late against their rhythm, ordering less, or both. */
export function QuietReasons({ c }: { c: QuietCustomer }) {
  const { t } = useI18n();
  const less = c.change_pct !== null && c.change_pct <= -30;
  return (
    <span className="flex flex-wrap gap-1.5">
      {c.late && (
        <Badge tone="late">
          {t('sales.quietLate', { days: c.days_since, rhythm: number(c.rhythm_days, 1) })}
        </Badge>
      )}
      {less && (
        <Badge tone="warn">
          <TrendingDown className="h-3 w-3" aria-hidden />
          {t('sales.quietLess', { change: `${c.change_pct}%` })}
        </Badge>
      )}
    </span>
  );
}

export function QuietRow({ c, compact }: { c: QuietCustomer; compact?: boolean }) {
  return (
    <Link
      href={`/sales/customers/${c.id}`}
      className={cn('flex items-center gap-3 px-3.5 transition-colors hover:bg-surface-2/60', compact ? 'py-2' : 'py-2.5')}
    >
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-[13.5px] font-medium">
          {c.company_name}
          {c.company_name_addition && <span className="font-normal text-muted"> · {c.company_name_addition}</span>}
        </span>
        <QuietReasons c={c} />
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
    </Link>
  );
}

/** Customers going quiet, most overdue first. They stay until they order again. */
export function QuietCustomerList({ customers }: { customers: QuietCustomer[] }) {
  const { t } = useI18n();
  return (
    <>
      <p className="mb-3 text-[12.5px] text-muted">{t('sales.quietHint')}</p>
      {customers.length === 0 ? (
        <EmptyState title={t('sales.quietNone')} body={t('sales.quietNoneBody')} />
      ) : (
        <Card className="divide-y divide-border">
          {customers.map((c) => <QuietRow key={c.id} c={c} />)}
        </Card>
      )}
    </>
  );
}
