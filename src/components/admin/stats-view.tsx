'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card, CardBody, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import type { Breakdown, Stats } from '@/domain/stats';

const RANGES = ['day', 'week', 'month', 'year'] as const;
export type StatsRange = (typeof RANGES)[number];

export function StatsView({ stats, range }: { stats: Stats; range: StatsRange }) {
  const { t } = useI18n();

  const tiles = [
    { label: t('stats.completionRate'), value: `${stats.completionRate}%`, tone: 'text-done' },
    { label: t('stats.completed'), value: stats.completed, tone: 'text-fg' },
    { label: t('stats.overdue'), value: stats.overdue, tone: stats.overdue > 0 ? 'text-late' : 'text-fg' },
    { label: t('stats.skipped'), value: stats.skipped, tone: 'text-muted' },
  ];

  return (
    <>
      <PageHeader title={t('admin.statsTitle')} subtitle={t('admin.statsSubtitle')} />

      <div className="mb-4 flex gap-1">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/admin/statistics?range=${r}`}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              range === r ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {t(`stats.range${r[0].toUpperCase()}${r.slice(1)}` as 'stats.rangeDay')}
          </Link>
        ))}
      </div>

      {stats.total === 0 ? (
        <EmptyState title={t('stats.noData')} />
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

          <BreakdownTable title={t('stats.byUser')} rows={stats.byUser} />
          <BreakdownTable title={t('stats.byCategory')} rows={stats.byCategory} />
          <BreakdownTable
            title={t('stats.byFrequency')}
            rows={stats.byFrequency.map((r) => ({
              ...r,
              label: t(`frequency.${r.key}` as 'frequency.daily'),
            }))}
          />
        </div>
      )}
    </>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  const { t } = useI18n();
  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-[13px] font-semibold">{title}</h2>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                <th className="px-3.5 py-2 text-left font-medium">{title}</th>
                <th className="px-2 py-2 text-right font-medium">{t('stats.completed')}</th>
                <th className="px-2 py-2 text-right font-medium">{t('stats.skipped')}</th>
                <th className="px-2 py-2 text-right font-medium">{t('stats.total')}</th>
                <th className="w-28 px-3.5 py-2 text-right font-medium">{t('stats.completionRate')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="max-w-[180px] truncate px-3.5 py-2">{r.label}</td>
                  <td className="px-2 py-2 text-right tabular">{r.completed}</td>
                  <td className="px-2 py-2 text-right tabular text-muted">{r.skipped}</td>
                  <td className="px-2 py-2 text-right tabular text-muted">{r.total}</td>
                  <td className="px-3.5 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-done" style={{ width: `${r.rate}%` }} />
                      </div>
                      <span className="w-8 text-right tabular text-[12px]">{r.rate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
