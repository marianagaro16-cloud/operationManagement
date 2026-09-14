'use client';

import Link from 'next/link';
import { Download } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Badge, Card, CardBody, EmptyState } from '@/components/ui/primitives';
import { ReportShell } from '@/components/reports/report-shell';
import {
  preparationReportToCsv,
  type PreparationReport,
  type PreparationState,
} from '@/domain/orders/preparation-report';

const STATE: Record<PreparationState, { key: MessageKey; tone: 'done' | 'warn' | 'neutral' }> = {
  done: { key: 'report.prepStateDone', tone: 'done' },
  in_progress: { key: 'report.prepStateInProgress', tone: 'warn' },
  not_started: { key: 'report.prepStateNotStarted', tone: 'neutral' },
};

/**
 * Preparation report — the Preparation tab of /admin/reports.
 *
 * Answers, for a day, a week or a month: how much of what was due to be
 * prepared actually was, whether it was done on the day, what was left short
 * and why, and who did it. Keyed on PREPARATION date; the Orders tab is the
 * delivery-date, commercial view of the same orders.
 */
export function PreparationReportView({ report, anchor }: { report: PreparationReport; anchor: string }) {
  const { t, formatDate } = useI18n();
  const { range } = report;

  function downloadCsv() {
    // Built in the browser from data already on the page — no round trip.
    const blob = new Blob([preparationReportToCsv(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `preparacion-${range.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tiles = [
    { label: t('report.prepOrders'), value: report.orders },
    {
      label: t('report.prepCompletion'),
      value: `${report.completionRate}%`,
      hint: `${report.done} / ${report.orders}`,
      tone: report.orders > 0 && report.completionRate >= 100 ? 'text-done' : report.completionRate > 0 ? 'text-warn' : undefined,
    },
    {
      label: t('report.prepOnTime'),
      value: report.done ? `${report.onTimeRate}%` : '—',
      hint: report.done ? `${report.onTime} / ${report.done}` : undefined,
      tone: report.done && report.onTimeRate >= 100 ? 'text-done' : report.late > 0 ? 'text-warn' : undefined,
    },
    { label: t('report.prepLots'), value: report.lots },
  ];

  // What still needs somebody: open orders, the late ones first.
  const open = report.rows
    .filter((r) => r.state !== 'done')
    .sort((a, b) => a.preparationDate.localeCompare(b.preparationDate) || a.reference - b.reference);

  const maxDay = Math.max(...report.byDay.map((d) => d.orders), 1);

  return (
    <ReportShell
      tab="preparation"
      range={range}
      anchor={anchor}
      action={
        report.orders > 0 ? (
          <button
            onClick={downloadCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:text-fg"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t('report.exportCsv')}
          </button>
        ) : undefined
      }
    >
      {report.orders === 0 ? (
        <EmptyState title={t('report.prepEmpty')} body={t('report.prepEmptyBody')} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {tiles.map((tile) => (
              <Card key={tile.label}>
                <CardBody className="pt-3.5">
                  <p className="text-[11.5px] text-muted">{tile.label}</p>
                  <p className={cn('mt-0.5 text-xl font-semibold tabular', tile.tone)}>{tile.value}</p>
                  {tile.hint && <p className="text-[11.5px] tabular text-subtle">{tile.hint}</p>}
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Anything the headline hides. */}
          {(report.inProgress > 0 || report.notStarted > 0 || report.late > 0 || report.overdueOpen > 0
            || report.shortLines > 0 || report.overAllocatedLines > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {report.overdueOpen > 0 && <Badge tone="late">{t('report.prepOverdueOpen')}: {report.overdueOpen}</Badge>}
              {report.late > 0 && <Badge tone="warn">{t('report.prepLate')}: {report.late}</Badge>}
              {report.inProgress > 0 && <Badge tone="warn">{t('report.prepStateInProgress')}: {report.inProgress}</Badge>}
              {report.notStarted > 0 && <Badge tone="neutral">{t('report.prepStateNotStarted')}: {report.notStarted}</Badge>}
              {report.shortLines > 0 && (
                <Badge tone="warn">
                  {t('report.shortLines')}: {report.shortLines}
                  {report.unexplainedShortLines > 0 && ` (${report.unexplainedShortLines} ${t('report.unexplained')})`}
                </Badge>
              )}
              {report.overAllocatedLines > 0 && (
                <Badge tone="late">{t('report.prepOverAllocated')}: {report.overAllocatedLines}</Badge>
              )}
            </div>
          )}

          {/* Who prepared — the question the lot authors exist to answer. */}
          <section>
            <h2 className="mb-2 text-[13px] font-semibold">{t('report.prepByPreparer')}</h2>
            {report.byPreparer.length === 0 ? (
              <EmptyState title={t('report.prepNoPreparers')} />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                        <th className="px-3 py-2 text-left font-medium">{t('report.prepPreparer')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.orders')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.lines')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.prepLots')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('report.prepDays')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.byPreparer.map((p) => (
                        <tr key={p.userId}>
                          <td className="max-w-[240px] truncate px-3 py-2" title={p.name}>{p.name}</td>
                          <td className="px-2 py-2 text-right tabular">{p.orders}</td>
                          <td className="px-2 py-2 text-right tabular text-muted">{p.lines}</td>
                          <td className="px-2 py-2 text-right font-medium tabular">{p.lots}</td>
                          <td className="px-3 py-2 text-right tabular text-muted">{p.days}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </section>

          {/* Still open — each row opens the order, where the work is done. */}
          {open.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">
                {t('report.prepOpenOrders')} <span className="font-normal tabular text-muted">{open.length}</span>
              </h2>
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                        <th className="px-3 py-2 text-left font-medium">#</th>
                        <th className="px-2 py-2 text-left font-medium">{t('orders.customer')}</th>
                        <th className="px-2 py-2 text-left font-medium">{t('report.prepDate')}</th>
                        <th className="px-2 py-2 text-left font-medium">{t('report.prepState')}</th>
                        <th className="px-3 py-2 text-left font-medium">{t('report.prepPreparer')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {open.slice(0, 100).map((r) => {
                        const overdue = r.preparationDate < DateTime.now().setZone(BUSINESS_TZ).toISODate()!;
                        return (
                          <tr key={r.id}>
                            <td className="px-3 py-2 tabular">
                              <Link href={`/orders/${r.id}`} className="text-muted hover:text-accent hover:underline">
                                {r.reference}
                              </Link>
                            </td>
                            <td className="max-w-[220px] truncate px-2 py-2" title={r.customer}>{r.customer}</td>
                            <td className={cn('px-2 py-2 tabular', overdue ? 'font-medium text-late' : 'text-muted')}>
                              {formatDate(r.preparationDate, 'short')}
                            </td>
                            <td className="px-2 py-2">
                              <Badge tone={STATE[r.state].tone}>{t(STATE[r.state].key)}</Badge>
                            </td>
                            <td className="max-w-[200px] truncate px-3 py-2 text-muted">{r.preparers.join(', ') || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          )}

          {/* Per day, only where it adds something. */}
          {range.kind !== 'day' && report.byDay.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('report.byDay')}</h2>
              <Card>
                <CardBody className="pt-3.5">
                  <ul className="space-y-1">
                    {report.byDay.map((d) => (
                      <li key={d.date} className="flex items-center gap-2 text-[12.5px]">
                        <span className="w-24 shrink-0 capitalize text-muted">{formatDate(d.date, 'short')}</span>
                        {/* Two layers: everything due that day, and how much of it got done. */}
                        <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <span className="absolute inset-y-0 left-0 rounded-full bg-accent/25" style={{ width: `${(d.orders / maxDay) * 100}%` }} />
                          <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${(d.done / maxDay) * 100}%` }} />
                        </span>
                        <span className="w-16 shrink-0 text-right tabular">{d.orders ? `${d.done} / ${d.orders}` : '—'}</span>
                        <span className="w-20 shrink-0 text-right tabular text-subtle">
                          {d.done ? t('report.prepOnTimeShort', { count: d.onTime }) : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </section>
          )}
        </div>
      )}
    </ReportShell>
  );
}
