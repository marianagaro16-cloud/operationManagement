'use client';

import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card, CardBody, EmptyState } from '@/components/ui/primitives';
import { StatusChip } from '@/components/ui/status-chip';
import { ReportShell } from '@/components/reports/report-shell';
import type { PeriodRange } from '@/domain/orders/reporting';
import type { InventoryReport } from '@/server/inventory';
import { INVENTORY_STATUSES } from '@/domain/inventory/types';

/**
 * Inventory report — the Inventory tab of /admin/reports.
 *
 * getInventoryReport() has been complete and correct in server/inventory.ts
 * since the module shipped, and was imported by no file in the repository.
 * This is the screen it was written for.
 *
 * Deliberately narrow, exactly as the server function is: what still needs
 * someone's attention, and what happened. Not an analytics suite.
 */
export function InventoryReportView({
  report,
  range,
  anchor,
}: {
  report: InventoryReport;
  range: PeriodRange;
  anchor: string;
}) {
  const { t } = useI18n();

  const total = INVENTORY_STATUSES.reduce((sum, s) => sum + report.totals[s], 0);

  const tiles = [
    { label: t('report.invTotal'), value: total, tone: 'text-fg' },
    {
      label: t('report.invNeedsReview'),
      value: report.unresolvedDifferences,
      tone: report.unresolvedDifferences > 0 ? 'text-late' : 'text-fg',
    },
    {
      label: t('report.invDigitalPending'),
      value: report.digitalPending,
      tone: report.digitalPending > 0 ? 'text-warn' : 'text-fg',
    },
    { label: t('report.invResolved'), value: report.resolvedDifferences, tone: 'text-muted' },
  ];

  return (
    <ReportShell tab="inventory" range={range} anchor={anchor}>
      {total === 0 ? (
        <EmptyState title={t('report.noInventories')} body={t('report.noInventoriesBody')} />
      ) : (
        <div className="space-y-5">
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

          {/* Status mix. Same chips as every other inventory screen, from the
              shared registry, so a "To review" here reads identically to a
              "To review" on the floor. */}
          <section>
            <h2 className="mb-2 text-[13px] font-semibold">{t('report.invStatusMix')}</h2>
            <Card>
              <CardBody className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3.5 text-[13px]">
                {INVENTORY_STATUSES.filter((s) => report.totals[s] > 0).map((status) => (
                  <span key={status} className="inline-flex items-center gap-1.5">
                    <StatusChip domain="inventory" status={status} />
                    <span className="font-medium tabular">{report.totals[status]}</span>
                  </span>
                ))}
              </CardBody>
            </Card>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-semibold">{t('report.invByTemplate')}</h2>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[380px] text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                      <th className="px-3.5 py-2 text-left font-medium">{t('inventory.title')}</th>
                      <th className="px-2 py-2 text-right font-medium">{t('report.invCount')}</th>
                      <th className="px-3.5 py-2 text-right font-medium">{t('report.invNeedsReview')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.byTemplate.map((row) => (
                      <tr key={row.templateId}>
                        <td className="max-w-[220px] truncate px-3.5 py-2">{row.name}</td>
                        <td className="px-2 py-2 text-right tabular text-muted">{row.count}</td>
                        <td
                          className={cn(
                            'px-3.5 py-2 text-right tabular',
                            row.reviews > 0 ? 'font-medium text-late' : 'text-muted',
                          )}
                        >
                          {row.reviews}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        </div>
      )}
    </ReportShell>
  );
}
