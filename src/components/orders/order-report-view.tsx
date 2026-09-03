'use client';

import Link from 'next/link';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge, Card, CardBody, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import {
  periodLabel,
  productReportToCsv,
  shiftPeriod,
  type OrderReport,
  type ReportPeriod,
} from '@/domain/orders/reporting';

const PERIODS: ReportPeriod[] = ['day', 'week', 'month'];

/**
 * Order report.
 *
 * Answers, for a day, a week or a month: how many orders, how much of each
 * product went out, who bought it, and how much of it was actually prepared.
 *
 * Keyed on DELIVERY date — this is the commercial view. Lotnummerkontrol
 * remains the preparation-date view of the same orders.
 */
export function OrderReportView({
  report,
  anchor,
}: {
  report: OrderReport;
  anchor: string;
}) {
  const { t, locale, formatDate } = useI18n();
  const { range } = report;

  const href = (kind: ReportPeriod, date: string) => `/admin/reports?period=${kind}&date=${date}`;

  function downloadCsv() {
    // Built in the browser from data already on the page — no round trip.
    const blob = new Blob([productReportToCsv(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos-${range.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tiles = [
    { label: t('report.orders'), value: report.orders },
    { label: t('report.customers'), value: report.customersServed },
    { label: t('report.unitsOrdered'), value: report.totalOrdered },
    {
      label: t('report.fulfilment'),
      value: `${report.fulfilmentRate}%`,
      tone: report.fulfilmentRate >= 100 ? 'text-done' : report.fulfilmentRate > 0 ? 'text-warn' : undefined,
    },
  ];

  return (
    <>
      <PageHeader title={t('report.title')} subtitle={t('report.subtitle')} />

      {/* Period type */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={href(p, anchor)}
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
          href={href(range.kind, shiftPeriod(range.kind, anchor, -1))}
          aria-label={t('calendar.prev')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <span className="min-w-[190px] text-center text-[14px] font-semibold capitalize">
          {periodLabel(range, locale)}
        </span>
        <Link
          href={href(range.kind, shiftPeriod(range.kind, anchor, 1))}
          aria-label={t('calendar.next')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>

        {report.byProduct.length > 0 && (
          <button
            onClick={downloadCsv}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:text-fg"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t('report.exportCsv')}
          </button>
        )}
      </div>

      {report.orders === 0 && report.cancelled === 0 ? (
        <EmptyState title={t('report.noOrders')} body={t('report.noOrdersBody')} />
      ) : (
        <div className="space-y-5">
          {/* Headline */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {tiles.map((tile) => (
              <Card key={tile.label}>
                <CardBody className="pt-3.5">
                  <p className="text-[11.5px] text-muted">{tile.label}</p>
                  <p className={cn('mt-0.5 text-xl font-semibold tabular', tile.tone)}>{tile.value}</p>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Anything the headline hides */}
          {(report.cancelled > 0 || report.draft > 0 || report.samples > 0 || report.shortLines > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {report.cancelled > 0 && (
                <Badge tone="late">{t('report.cancelled')}: {report.cancelled}</Badge>
              )}
              {report.draft > 0 && (
                <Badge tone="warn">{t('orders.statusDraft')}: {report.draft}</Badge>
              )}
              {report.samples > 0 && (
                <Badge tone="accent">{t('orders.typeSample')}: {report.samples}</Badge>
              )}
              {report.shortLines > 0 && (
                <Badge tone="warn">
                  {t('report.shortLines')}: {report.shortLines}
                  {report.unexplainedShortLines > 0 && ` (${report.unexplainedShortLines} ${t('report.unexplained')})`}
                </Badge>
              )}
            </div>
          )}

          {/* Products — the main table */}
          <section>
            <h2 className="mb-2 text-[13px] font-semibold">{t('report.byProduct')}</h2>
            {report.byProduct.length === 0 ? (
              <EmptyState title={t('stats.noData')} />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                        <th className="px-3 py-2 text-left font-medium">{t('master.code')}</th>
                        <th className="px-2 py-2 text-left font-medium">{t('orders.product')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('orders.ordered')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.prepared')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('orders.remaining')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('report.customersShort')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.byProduct.map((p) => (
                        <tr key={p.productId}>
                          <td className="px-3 py-2 tabular text-subtle">{p.code ?? '—'}</td>
                          <td className="max-w-[280px] truncate px-2 py-2" title={p.name}>{p.name}</td>
                          <td className="px-2 py-2 text-right font-medium tabular">{p.ordered}</td>
                          <td className="px-2 py-2 text-right tabular text-muted">{p.prepared}</td>
                          <td className={cn('px-2 py-2 text-right tabular', p.missing > 0 ? 'text-warn' : 'text-subtle')}>
                            {p.missing || '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular text-muted">{p.customers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </section>

          {/* Customers */}
          {report.byCustomer.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('report.byCustomer')}</h2>
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                        <th className="px-3 py-2 text-left font-medium">{t('orders.customer')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.orders')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('report.lines')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('report.unitsOrdered')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.byCustomer.map((c) => (
                        <tr key={c.customerId}>
                          <td className="max-w-[260px] truncate px-3 py-2" title={c.name}>{c.name}</td>
                          <td className="px-2 py-2 text-right tabular">{c.orders}</td>
                          <td className="px-2 py-2 text-right tabular text-muted">{c.lines}</td>
                          <td className="px-3 py-2 text-right font-medium tabular">{c.ordered}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          )}

          {/* Per-day trend, only where it adds something */}
          {range.kind !== 'day' && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('report.byDay')}</h2>
              <Card>
                <CardBody className="pt-3.5">
                  <ul className="space-y-1">
                    {report.byDay.map((d) => {
                      const max = Math.max(...report.byDay.map((x) => x.ordered), 1);
                      return (
                        <li key={d.date} className="flex items-center gap-2 text-[12.5px]">
                          <span className="w-24 shrink-0 capitalize text-muted">
                            {formatDate(d.date, 'short')}
                          </span>
                          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${(d.ordered / max) * 100}%` }}
                            />
                          </span>
                          <span className="w-10 shrink-0 text-right tabular">{d.ordered || '—'}</span>
                          <span className="w-14 shrink-0 text-right tabular text-subtle">
                            {d.orders ? `${d.orders} ${t('report.ordersShort')}` : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardBody>
              </Card>
            </section>
          )}

          {/* Delivery methods */}
          {report.byDeliveryMethod.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('orders.deliveryMethod')}</h2>
              <Card>
                <CardBody className="flex flex-wrap gap-x-4 gap-y-1 pt-3.5 text-[13px]">
                  {report.byDeliveryMethod.map((m) => (
                    <span key={m.key} className="text-muted">
                      {m.label || t('common.none')}:{' '}
                      <span className="font-medium tabular text-fg">{m.orders}</span>
                    </span>
                  ))}
                </CardBody>
              </Card>
            </section>
          )}
        </div>
      )}
    </>
  );
}
