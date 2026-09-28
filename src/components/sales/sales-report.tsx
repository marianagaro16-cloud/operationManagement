'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDownRight, ArrowUpRight, Download } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Select } from '@/components/ui/primitives';
import { changePct, salesReportToCsv, type ReportRow } from '@/domain/sales/report';
import type { SalesReport, SalesReportLine } from '@/types/sales';

type View = 'customers' | 'products' | 'types';
type Measure = 'quantity' | 'kg';

const number = (n: number, digits = 0) =>
  new Intl.NumberFormat('de-CH', { maximumFractionDigits: digits }).format(Number(n));

/** Up or down against the period before, with an arrow: never colour alone. */
function Change({ now, before }: { now: number; before: number }) {
  const { t } = useI18n();
  const pct = changePct(now, before);
  if (pct === null) return <span className="text-[12px] text-subtle">{t('sales.reportNoBefore')}</span>;
  const Icon = pct >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[12px] font-medium tabular', pct >= 0 ? 'text-done' : 'text-late')}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {pct > 0 ? '+' : ''}{pct}%
    </span>
  );
}

/**
 * The sales report: a month against the one before — while it runs, against
 * the same days — by customer, product or type of business, with the months
 * since history began. Units and net kg; the app has no prices.
 */
export function SalesReportView({ report, month, months }: { report: SalesReport; month: string; months: string[] }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [view, setView] = useState<View>('customers');
  const [measure, setMeasure] = useState<Measure>('quantity');
  const { totals } = report;

  const rows: ReportRow[] = useMemo(() => {
    const lines: SalesReportLine[] = report[view];
    return lines.map((l) => ({
      id: l.id,
      name: l.name,
      detail: view === 'products' ? l.code ?? null : view === 'customers' ? l.city ?? null : null,
      customers: l.customers,
      quantity: Number(l.quantity),
      kg: Number(l.kg),
      prev_quantity: Number(l.prev_quantity),
      prev_kg: Number(l.prev_kg),
    }));
  }, [report, view]);

  function downloadCsv() {
    const columns = view === 'customers' ? { name: 'customer', detail: 'city' }
      : view === 'products' ? { name: 'product', detail: 'code' }
        : { name: 'customer_type' };
    const blob = new Blob([salesReportToCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ventas-${view}-${month.slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const range = (r: { from: string; to: string }) => `${formatDate(r.from, 'short')} – ${formatDate(r.to, 'short')}`;
  const views: { key: View; label: string }[] = [
    { key: 'customers', label: t('sales.reportByCustomer') },
    { key: 'products', label: t('sales.reportByProduct') },
    { key: 'types', label: t('sales.reportByType') },
  ];

  return (
    <div className="space-y-4">
      {/* The month, and what it is compared with */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="report-month" className="mb-1 block text-[12px] font-medium text-muted">{t('sales.reportMonth')}</label>
          <Select
            id="report-month"
            value={month.slice(0, 7)}
            onChange={(e) => router.push(`/sales?tab=report&month=${e.target.value}`)}
            className="w-auto"
          >
            {months.map((m) => (
              <option key={m} value={m.slice(0, 7)}>{formatDate(m, 'monthYear')}</option>
            ))}
          </Select>
        </div>
        <p className="text-[12px] text-muted">
          {t('sales.reportCompared', { now: range(report.period), before: range(report.previous) })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Card className="p-3">
          <p className="text-[11.5px] font-medium text-muted">{t('sales.reportUnits')}</p>
          <p className="mt-0.5 text-[18px] font-semibold tabular">{number(totals.quantity)}</p>
          <Change now={totals.quantity} before={totals.prev_quantity} />
        </Card>
        <Card className="p-3">
          <p className="text-[11.5px] font-medium text-muted">{t('sales.reportKg')}</p>
          <p className="mt-0.5 text-[18px] font-semibold tabular">{number(totals.kg, 1)}</p>
          <Change now={totals.kg} before={totals.prev_kg} />
        </Card>
        <Card className="col-span-2 p-3 sm:col-span-1">
          <p className="text-[11.5px] font-medium text-muted">{t('sales.reportCustomers')}</p>
          <p className="mt-0.5 text-[18px] font-semibold tabular">{number(totals.customers)}</p>
        </Card>
      </div>
      <p className="-mt-2 text-[11.5px] text-subtle">{t('sales.kgHint')}</p>

      {/* By customer, product or type */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5" role="tablist">
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                view === v.key ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={downloadCsv} disabled={rows.length === 0}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t('sales.reportCsv')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t('sales.reportEmpty')} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[11.5px] text-muted">
                <th className="px-3 py-2 font-medium">
                  {view === 'customers' ? t('sales.reportCustomer') : view === 'products' ? t('sales.reportProduct') : t('sales.businessType')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{t('sales.reportUnits')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('sales.reportKg')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('sales.reportBefore')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('sales.reportChange')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={r.id ?? i}>
                  <td className="max-w-[16rem] px-3 py-1.5">
                    {view === 'customers' && r.id ? (
                      <Link href={`/sales/customers/${r.id}`} className="block truncate hover:text-accent">{r.name}</Link>
                    ) : (
                      <span className="block truncate">{r.name}</span>
                    )}
                    {(r.detail || (view === 'types' && r.customers !== undefined)) && (
                      <span className="block truncate text-[11.5px] text-subtle">
                        {view === 'types' ? t('sales.reportCustomersCount', { count: r.customers ?? 0 }) : r.detail}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">{number(r.quantity)}</td>
                  <td className="px-3 py-1.5 text-right tabular text-muted">{number(r.kg, 1)}</td>
                  <td className="px-3 py-1.5 text-right tabular text-muted">{number(r.prev_quantity)}</td>
                  <td className="px-3 py-1.5 text-right"><Change now={r.quantity} before={r.prev_quantity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Trend trend={report.trend} measure={measure} onMeasure={setMeasure} />
    </div>
  );
}

/**
 * Units or kg per month since history began: one measure at a time, never
 * two scales on one axis. Thin bars, a tooltip on each, and the numbers in a
 * table under it.
 */
function Trend({
  trend,
  measure,
  onMeasure,
}: {
  trend: SalesReport['trend'];
  measure: Measure;
  onMeasure: (m: Measure) => void;
}) {
  const { t, formatDate } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  if (trend.length === 0) return null;
  const values = trend.map((m) => Number(m[measure]));
  const max = Math.max(...values, 1);
  const fmt = (v: number) => (measure === 'kg' ? `${number(v, 1)} kg` : number(v));

  return (
    <Card className="p-3.5 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">{t('sales.reportTrend')}</h2>
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {(['quantity', 'kg'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={measure === m}
              onClick={() => onMeasure(m)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[12px] font-medium',
                measure === m ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {m === 'quantity' ? t('sales.reportUnits') : t('sales.reportKg')}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex h-40 items-end gap-[2px] border-b border-border" role="img" aria-label={t('sales.reportTrend')}>
        {trend.map((m, i) => (
          <div
            key={m.month}
            className="relative flex h-full min-w-0 flex-1 items-end justify-center"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            tabIndex={0}
          >
            <div
              className={cn('w-full max-w-10 rounded-t-[4px] bg-accent transition-opacity', hover !== null && hover !== i && 'opacity-50')}
              style={{ height: `${Math.max((values[i] / max) * 100, values[i] > 0 ? 2 : 0)}%` }}
            />
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] shadow-pop">
                <span className="block font-medium">{formatDate(m.month, 'monthYear')}</span>
                <span className="tabular text-muted">{fmt(values[i])}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {trend.map((m) => (
          <span key={m.month} className="min-w-0 flex-1 truncate text-center text-[10.5px] text-subtle">
            {formatDate(m.month, 'monthYear')}
          </span>
        ))}
      </div>

      {/* The same numbers, readable without the chart. */}
      <table className="mt-3 w-full text-[12px]">
        <tbody className="divide-y divide-border">
          {trend.map((m) => (
            <tr key={m.month}>
              <td className="py-1">{formatDate(m.month, 'monthYear')}</td>
              <td className="py-1 text-right tabular">{number(Number(m.quantity))}</td>
              <td className="py-1 text-right tabular text-muted">{number(Number(m.kg), 1)} kg</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
