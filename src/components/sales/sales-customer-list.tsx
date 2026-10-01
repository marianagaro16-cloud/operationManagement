'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Search } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { Badge, Card, Checkbox, EmptyState, Input } from '@/components/ui/primitives';
import { BUSINESS_TZ } from '@/lib/datetime';
import type { SalesCustomerRow } from '@/types/sales';

/** Every customer, those ordering most recently first. */
export function SalesCustomerList({
  customers,
  today,
  flagged = {},
  prepay = [],
}: {
  /** Customers who must pay before delivery. */
  prepay?: string[];
  customers: SalesCustomerRow[];
  today: string;
  /** Customers with an open collection case, and how far: a reminder, or payments pending. */
  flagged?: Record<string, 'reminder' | 'pending'>;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers
      .filter((c) => showInactive || c.is_active)
      .filter((c) => !q || `${c.company_name} ${c.company_name_addition ?? ''} ${c.city ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.last_order ?? '').localeCompare(a.last_order ?? '') || a.company_name.localeCompare(b.company_name));
  }, [customers, query, showInactive]);

  const ago = (date: string) =>
    Math.round(DateTime.fromISO(today, { zone: BUSINESS_TZ }).diff(DateTime.fromISO(date, { zone: BUSINESS_TZ }), 'days').days);

  return (
    <>
      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            aria-label={t('sales.search')}
            placeholder={t('sales.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Checkbox label={t('sales.showInactive')} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
      </div>

      {shown.length === 0 ? (
        <EmptyState title={t('sales.noCustomers')} />
      ) : (
        <Card className="divide-y divide-border">
          {shown.map((c) => (
            <Link
              key={c.id}
              href={`/sales/customers/${c.id}`}
              className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2/60"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-medium">{c.company_name}</span>
                  {!c.is_active && <Badge tone="neutral">{t('sales.inactive')}</Badge>}
                  {flagged[c.id] === 'pending' && <Badge tone="late">{t('collection.flag')}</Badge>}
                  {flagged[c.id] === 'reminder' && <Badge tone="warn">{t('collection.flagReminder')}</Badge>}
                  {prepay.includes(c.id) && <Badge tone="late">{t('collection.prepay')}</Badge>}
                </span>
                <span className="block truncate text-[12px] text-muted">
                  {[c.company_name_addition, c.city].filter(Boolean).join(' · ')}
                </span>
                <span className="block truncate text-[12px] text-muted sm:hidden">
                  {t('sales.lastOrder')}: {c.last_order ? t('sales.daysAgo', { days: ago(c.last_order) }) : t('sales.never')}
                </span>
              </span>
              <span className="hidden shrink-0 text-right text-[12px] text-muted sm:block">
                <span className="block">
                  {t('sales.lastOrder')}: {c.last_order ? t('sales.daysAgo', { days: ago(c.last_order) }) : t('sales.never')}
                </span>
                <span className="block">
                  {t('sales.ordersIn90', { count: c.orders_90d })}
                  {c.notes > 0 && ` · ${t('sales.notesCount', { count: c.notes })}`}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
