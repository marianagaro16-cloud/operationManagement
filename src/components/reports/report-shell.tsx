'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardBody, ErrorState, Field, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import {
  periodLabel,
  shiftCustomRange,
  shiftPeriod,
  type PeriodRange,
  type ReportPeriod,
} from '@/domain/orders/reporting';

/**
 * The reporting shell: tabs, period selector, period navigation.
 *
 * There used to be two report screens with two definitions of a period.
 * /admin/reports used periodRange() from the orders domain; /admin/statistics
 * computed its own bounds inline with startOf/endOf and offered a different
 * set of ranges. A manager asking about "September" could get two answers, and
 * switching between the screens lost the period entirely because neither knew
 * the other's concept.
 *
 * Inventory had a third position: getInventoryReport() was fully written and
 * rendered by nothing at all.
 *
 * One shell, one period model, three tabs. The period lives in the URL, so
 * moving from Orders to Inventory keeps the month you were looking at.
 */

export type ReportTab = 'orders' | 'tasks' | 'inventory';

const TABS: ReportTab[] = ['orders', 'tasks', 'inventory'];
const PERIODS: ReportPeriod[] = ['day', 'week', 'month', 'year', 'custom'];

/** Every link in here keeps the tab and the period together. */
export function reportHref(
  tab: ReportTab,
  range: PeriodRange,
  anchor: string,
  override?: { period?: ReportPeriod; date?: string; from?: string; to?: string },
): string {
  const period = override?.period ?? range.kind;
  const params = new URLSearchParams({ tab, period });

  if (period === 'custom') {
    params.set('from', override?.from ?? range.start);
    params.set('to', override?.to ?? range.end);
  } else {
    params.set('date', override?.date ?? anchor);
  }
  return `/admin/reports?${params.toString()}`;
}

export function ReportShell({
  tab,
  range,
  anchor,
  action,
  children,
}: {
  tab: ReportTab;
  range: PeriodRange;
  anchor: string;
  /** Tab-specific control shown beside the period nav, e.g. Export CSV. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t, locale } = useI18n();
  const [from, setFrom] = useState(range.start);
  const [to, setTo] = useState(range.end);
  const isCustom = range.kind === 'custom';

  // A custom range slides by its own length rather than by a calendar unit,
  // so "previous" on a 10-day window means the 10 days before it.
  const prevHref = isCustom
    ? (() => { const r = shiftCustomRange(range, -1); return reportHref(tab, range, anchor, { period: 'custom', from: r.start, to: r.end }); })()
    : reportHref(tab, range, anchor, { date: shiftPeriod(range.kind, anchor, -1) });

  const nextHref = isCustom
    ? (() => { const r = shiftCustomRange(range, 1); return reportHref(tab, range, anchor, { period: 'custom', from: r.start, to: r.end }); })()
    : reportHref(tab, range, anchor, { date: shiftPeriod(range.kind, anchor, 1) });

  return (
    <>
      <PageHeader title={t('report.title')} subtitle={t('report.subtitle')} />

      {/* Which module. Switching tabs preserves the period below. */}
      <nav className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1 border-b border-border pb-px">
          {TABS.map((item) => (
            <li key={item}>
              <Link
                href={reportHref(item, range, anchor)}
                className={cn(
                  'inline-block whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                  tab === item
                    ? 'border-accent text-fg'
                    : 'border-transparent text-muted hover:text-fg',
                )}
              >
                {t(`report.tab${item[0].toUpperCase()}${item.slice(1)}` as 'report.tabOrders')}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Period type */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={reportHref(tab, range, anchor, { period: p })}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              range.kind === p
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border bg-surface text-muted hover:text-fg',
            )}
          >
            {t(`report.period${p[0].toUpperCase()}${p.slice(1)}` as 'report.periodDay')}
          </Link>
        ))}
      </div>

      {/* Period navigation */}
      <div className="mb-4 flex items-center gap-1">
        <Link
          href={prevHref}
          aria-label={t('calendar.prev')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <span className="min-w-[190px] text-center text-[14px] font-semibold capitalize">
          {periodLabel(range, locale)}
        </span>
        <Link
          href={nextHref}
          aria-label={t('calendar.next')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>

        {action && <div className="ml-auto">{action}</div>}
      </div>

      {isCustom && (
        <Card className="mb-4">
          <CardBody className="pt-3.5">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('report.from')} htmlFor="r-from">
                <Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label={t('report.to')} htmlFor="r-to">
                <Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Link href={reportHref(tab, range, anchor, { period: 'custom', from, to })}>
                <Button variant="primary">{t('report.apply')}</Button>
              </Link>
            </div>
            {range.clamped && (
              <div className="mt-2"><ErrorState message={t('report.rangeClamped')} /></div>
            )}
          </CardBody>
        </Card>
      )}

      {children}
    </>
  );
}
