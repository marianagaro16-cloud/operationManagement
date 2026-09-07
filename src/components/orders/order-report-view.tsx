'use client';

import Link from 'next/link';
import { Download } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge, Card, CardBody, EmptyState } from '@/components/ui/primitives';
import { ReportShell } from '@/components/reports/report-shell';
import { productReportToCsv, type OrderReport } from '@/domain/orders/reporting';

/**
 * Order report — the Orders tab of /admin/reports.
 *
 * Answers, for a day, a week or a month: how many orders, how much of each
 * product went out, who bought it, and how much of it was actually prepared.
 *
 * Keyed on DELIVERY date — this is the commercial view. Lotnummerkontrol
 * remains the preparation-date view of the same orders.
 *
 * The period selector, the navigation and the custom-range pickers used to
 * live in this file, which is why the statistics screen next door grew its own
 * incompatible copy. They are now in ReportShell and shared by all three tabs.
 */
export function OrderReportView({
  report,
  anchor,
}: {
  report: OrderReport;
  anchor: string;
}) {
  const { t, formatDate } = useI18n();
  const { range } = report;

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
    <ReportShell
      tab="orders"
      range={range}
      anchor={anchor}
      action={
        report.byProduct.length > 0 ? (
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
                          {/* The orders behind the number. Every row of this
                              report used to be dead text over a query that
                              already knew how to filter. */}
                          <td className="max-w-[260px] truncate px-3 py-2" title={c.name}>
                            <Link
                              href={`/orders?month=${range.start.slice(0, 7)}&customer=${c.customerId}`}
                              className="transition-colors hover:text-accent hover:underline"
                            >
                              {c.name}
                            </Link>
                          </td>
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

          {/* Per-month trend for long ranges — 365 daily rows is unreadable */}
          {report.byMonth.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('report.byMonth')}</h2>
              <Card>
                <CardBody className="pt-3.5">
                  <ul className="space-y-1">
                    {report.byMonth.map((m) => {
                      const max = Math.max(...report.byMonth.map((x) => x.ordered), 1);
                      return (
                        <li key={m.month} className="flex items-center gap-2 text-[12.5px]">
                          <span className="w-24 shrink-0 capitalize text-muted">
                            {formatDate(`${m.month}-01`, 'monthYear')}
                          </span>
                          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${(m.ordered / max) * 100}%` }}
                            />
                          </span>
                          <span className="w-12 shrink-0 text-right tabular">{m.ordered || '—'}</span>
                          <span className="w-16 shrink-0 text-right tabular text-subtle">
                            {m.orders ? `${m.orders} ${t('report.ordersShort')}` : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardBody>
              </Card>
            </section>
          )}

          {/* Per-day trend, only where it adds something */}
          {range.kind !== 'day' && report.byDay.length > 0 && (
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
    </ReportShell>
  );
}
