'use client';

import Link from 'next/link';
import { createContext, useContext, useState, type ReactNode } from 'react';
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
import { REPORT_TABS, type ReportTab } from './report-tabs';

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

export type { ReportTab };

/**
 * Which tabs this viewer gets — allowedReportTabs(). Set once by the page for
 * the whole screen, so the report views need not each carry it.
 */
const ReportTabsContext = createContext<ReportTab[]>(REPORT_TABS);

export function ReportTabsProvider({ tabs, children }: { tabs: ReportTab[]; children: ReactNode }) {
  return <ReportTabsContext.Provider value={tabs}>{children}</ReportTabsContext.Provider>;
}

const PERIODS: ReportPeriod[] = ['day', 'week', 'month', 'year', 'custom'];

/** Every link in here keeps the tab and the period together. */
export function reportHref(
  tab: ReportTab,
  range: PeriodRange,
  anchor: string,
  override?: { period?: ReportPeriod; date?: string; from?: string; to?: string },
  /** Tab-specific filters (e.g. customer, product), kept while moving through periods. */
  filters?: Record<string, string | undefined>,
): string {
  const period = override?.period ?? range.kind;
  const params = new URLSearchParams({ tab, period });

  if (period === 'custom') {
    params.set('from', override?.from ?? range.start);
    params.set('to', override?.to ?? range.end);
  } else {
    params.set('date', override?.date ?? anchor);
  }
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value) params.set(key, value);
  }
  return `/admin/reports?${params.toString()}`;
}

/**
 * The Informes title and its tabs, without the period controls.
 *
 * ReportShell draws it above its period selector. The Incidents and
 * Reception tabs draw it on its own: they are monthly and keep their saved
 * versions, so they bring their own month controls.
 */
export function ReportHeader({
  tab,
  hrefFor = (item) => `/admin/reports?tab=${item}`,
  action,
}: {
  tab: ReportTab;
  /** Where each tab links; by default it opens on that tab's own default period. */
  hrefFor?: (tab: ReportTab) => string;
  /** Beside the title, e.g. the incident report's Export CSV. */
  action?: ReactNode;
}) {
  const { t } = useI18n();
  const tabs = useContext(ReportTabsContext);
  return (
    <>
      <PageHeader title={t('report.title')} subtitle={t('report.subtitle')} action={action} />
      <nav className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1 border-b border-border pb-px">
          {tabs.map((item) => (
            <li key={item}>
              <Link
                href={hrefFor(item)}
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
    </>
  );
}

/** Back from a saved report to its tab. */
export function BackToReports({ tab }: { tab: ReportTab }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/admin/reports?tab=${tab}`}
      className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-fg"
    >
      <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
      {t('report.backToReports')}
    </Link>
  );
}

export function ReportShell({
  tab,
  range,
  anchor,
  filters,
  action,
  children,
}: {
  tab: ReportTab;
  range: PeriodRange;
  anchor: string;
  /**
   * This tab's filters. Carried by the period links so stepping to the next
   * month keeps looking at the same customer; dropped when switching tabs,
   * where they mean nothing.
   */
  filters?: Record<string, string | undefined>;
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
    ? (() => { const r = shiftCustomRange(range, -1); return reportHref(tab, range, anchor, { period: 'custom', from: r.start, to: r.end }, filters); })()
    : reportHref(tab, range, anchor, { date: shiftPeriod(range.kind, anchor, -1) }, filters);

  const nextHref = isCustom
    ? (() => { const r = shiftCustomRange(range, 1); return reportHref(tab, range, anchor, { period: 'custom', from: r.start, to: r.end }, filters); })()
    : reportHref(tab, range, anchor, { date: shiftPeriod(range.kind, anchor, 1) }, filters);

  return (
    <>
      {/* Switching tabs preserves the period below. */}
      <ReportHeader tab={tab} hrefFor={(item) => reportHref(item, range, anchor)} />

      {/* Period type */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={reportHref(tab, range, anchor, { period: p }, filters)}
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
              <Link href={reportHref(tab, range, anchor, { period: 'custom', from, to }, filters)}>
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
