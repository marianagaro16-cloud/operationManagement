'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/app-shell';

/** The Sales section's title and tabs: every customer, those going quiet, and prospects. */
export type SalesTab = 'customers' | 'quiet' | 'prospects' | 'report';

export function SalesHeader({ tab, quietCount }: { tab: SalesTab; quietCount: number }) {
  const { t } = useI18n();
  const tabs = [
    { key: 'customers', label: t('sales.tabCustomers'), href: '/sales' },
    { key: 'quiet', label: t('sales.tabQuiet'), href: '/sales?tab=quiet', count: quietCount },
    { key: 'prospects', label: t('sales.tabProspects'), href: '/sales?tab=prospects' },
    { key: 'report', label: t('sales.tabReport'), href: '/sales?tab=report' },
  ] as const;

  return (
    <>
      <PageHeader title={t('sales.navLabel')} subtitle={t('sales.subtitle')} />
      <nav className="mb-3 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === item.key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {item.label}
            {'count' in item && item.count > 0 && (
              <span className="ml-1.5 text-[11px] tabular text-late">{item.count}</span>
            )}
          </Link>
        ))}
      </nav>
    </>
  );
}
