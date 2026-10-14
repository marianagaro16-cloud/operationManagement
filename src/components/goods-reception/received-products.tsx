'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card, EmptyState, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { formatQuantity } from '@/domain/goods-reception/expected';
import type { ReceivedProductRow, Supplier } from '@/types/goods-reception';
import { ReceptionTabs, useExpectedLabels } from './expected-bits';

/**
 * Every product that arrived, with its best-before date — by month, supplier
 * or product, newest arrival or soonest best-before first. Replaces copying
 * the deliveries into the order-control workbook (2026-10-14).
 */
export function ReceivedProducts({
  rows,
  suppliers,
  filters,
  months,
  today,
  showExpected,
  expectedCount,
  canExport,
}: {
  rows: ReceivedProductRow[];
  suppliers: Supplier[];
  filters: { month: string; supplier: string; q: string; sort: 'arrival' | 'best_before' };
  /** "YYYY-MM", newest first. */
  months: string[];
  today: string;
  showExpected: boolean;
  expectedCount: number;
  canExport: boolean;
}) {
  const { t, formatDate, locale } = useI18n();
  const router = useRouter();
  const labels = useExpectedLabels();
  const [q, setQ] = useState(filters.q);

  const query = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch };
    const p = new URLSearchParams({ tab: 'products' });
    if (next.month) p.set('month', next.month);
    if (next.supplier) p.set('supplier', next.supplier);
    if (next.q) p.set('q', next.q);
    if (next.sort === 'best_before') p.set('sort', 'best_before');
    return p;
  };
  const go = (patch: Partial<typeof filters>) => router.push(`/goods-reception?${query(patch).toString()}`, { scroll: false });
  const monthName = (m: string) =>
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${m}-15T12:00:00`));

  const exportParams = query({});
  exportParams.delete('tab');

  return (
    <>
      <PageHeader title={t('gr.navLabel')} />
      <ReceptionTabs tab="products" expectedCount={expectedCount} showExpected={showExpected} />

      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Select value={filters.month} onChange={(e) => go({ month: e.target.value })} aria-label={t('grLines.month')}>
          <option value="all">{t('grLines.allMonths')}</option>
          {months.map((m) => (
            <option key={m} value={m}>{monthName(m)}</option>
          ))}
        </Select>
        <Select value={filters.supplier} onChange={(e) => go({ supplier: e.target.value })} aria-label={t('grLines.supplier')}>
          <option value="">{t('grLines.allSuppliers')}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => q !== filters.q && go({ q })}
          onKeyDown={(e) => { if (e.key === 'Enter') go({ q }); }}
          placeholder={t('grLines.search')}
          aria-label={t('grLines.search')}
        />
        <Select value={filters.sort} onChange={(e) => go({ sort: e.target.value as 'arrival' | 'best_before' })} aria-label={t('grLines.byBestBefore')}>
          <option value="arrival">{t('grLines.byArrival')}</option>
          <option value="best_before">{t('grLines.byBestBefore')}</option>
        </Select>
      </div>

      {canExport && rows.length > 0 && (
        <div className="mb-3 flex justify-end">
          <a
            href={`/goods-reception/products-export?${exportParams.toString()}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t('grLines.export')}
          </a>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title={t('grLines.empty')} />
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((r) => {
            const expired = !!r.best_before && r.best_before < today;
            return (
              <Link key={r.id} href={`/goods-reception/${r.reception.id}`} className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[13.5px] font-medium">
                    {r.product_code && <span className="mr-1.5 tabular text-subtle">{r.product_code}</span>}
                    {r.product_name}
                  </p>
                  <p className="text-[12px] text-muted">
                    {[
                      r.quantity !== null ? `${formatQuantity(r.quantity)} ${labels.unit(r.unit)}` : null,
                      r.reception.supplier_name,
                      `${t('grLines.arrived')} ${formatDate(r.reception.received_at.slice(0, 10), 'short')}`,
                      r.reception.delivery_note && `${t('grLines.deliveryNote')} ${r.reception.delivery_note}`,
                      r.lot_number && `${t('grLines.lot')} ${r.lot_number}`,
                    ].filter(Boolean).join(' · ')}
                  </p>
                  {r.note && <p className="text-[12px] text-muted">{r.note}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] uppercase tracking-wide text-subtle">{t('grLines.bestBefore')}</p>
                  <p className={cn('text-[13px] font-semibold tabular', !r.best_before ? 'font-normal text-subtle' : expired ? 'text-late' : 'text-fg')}>
                    {r.best_before ? formatDate(r.best_before, 'medium') : t('grLines.noDate')}
                  </p>
                  <p className="text-[11px] tabular text-subtle">{r.reception.reception_number}</p>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </>
  );
}
