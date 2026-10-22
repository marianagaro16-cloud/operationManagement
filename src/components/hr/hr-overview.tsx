'use client';

import Link from 'next/link';
import { FileSpreadsheet } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { OVERVIEW_PERIODS, type OverviewPeriod, type OverviewRow } from '@/domain/hr/overview';
import { teamLabelKey, type Team } from '@/lib/authz';

/** People | Overview, under the HR heading. */
export function HrTabs({ active }: { active: 'people' | 'summary' }) {
  const { t } = useI18n();
  return (
    <nav className="mb-3 flex gap-1 border-b border-border">
      {(['people', 'summary'] as const).map((key) => (
        <Link
          key={key}
          href={key === 'people' ? '/hr' : '/hr?view=summary'}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
            active === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {key === 'people' ? t('hrOverview.tabPeople') : t('hrOverview.tabSummary')}
        </Link>
      ))}
    </nav>
  );
}

/** A number that only draws the eye when it is not zero. */
function N({ n, tone = 'fg' }: { n: number; tone?: 'fg' | 'late' | 'warn' | 'done' }) {
  if (n === 0) return <span className="text-subtle">0</span>;
  return <span className={cn('font-medium', tone === 'late' && 'text-late', tone === 'warn' && 'text-warn', tone === 'done' && 'text-done')}>{n}</span>;
}

/**
 * Everyone at a glance over a period: arrivals, what the log says, what is
 * still open, evaluations and training. Each name opens the file.
 */
export function HrOverview({ rows, period, from, to, today }: { rows: OverviewRow[]; period: OverviewPeriod; from: string; to: string; today: string }) {
  const { t, formatDate } = useI18n();
  const periodLabel = (p: OverviewPeriod) => t(`hrOverview.period${p === 'year' ? 'Year' : p}` as 'hrOverview.period3m');
  const level = (l: OverviewRow['worstWarning']) =>
    l === 'final' ? t('hrOverview.levelFinal') : l === 'written' ? t('hrOverview.levelWritten') : l === 'verbal' ? t('hrOverview.levelVerbal') : null;
  const head = 'whitespace-nowrap px-2.5 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-muted';
  const cell = 'whitespace-nowrap px-2.5 py-2 tabular';

  return (
    <>
      <PageHeader
        title={t('hr.navLabel')}
        subtitle={t('hr.subtitle')}
        action={
          <a
            href={`/hr/export?kind=overview&period=${period}`}
            download
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
            {t('hrOverview.excel')}
          </a>
        }
      />
      <HrTabs active="summary" />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {OVERVIEW_PERIODS.map((p) => (
          <Link
            key={p}
            href={`/hr?view=summary&period=${p}`}
            aria-current={p === period ? 'true' : undefined}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              p === period ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-muted hover:text-fg',
            )}
          >
            {periodLabel(p)}
          </Link>
        ))}
        <span className="ml-1 text-[12px] text-muted">{t('hrOverview.range', { from: formatDate(from, 'medium'), to: formatDate(to, 'medium') })}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t('hrOverview.none')} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="border-b border-border">
              <tr>
                <th className={head}>{t('hrOverview.person')}</th>
                <th className={head} title={t('hrOverview.lateHint')}>{t('hrOverview.late')}</th>
                <th className={head}>{t('hrOverview.early')}</th>
                <th className={head}>{t('hrOverview.warnings')}</th>
                <th className={head}>{t('hrOverview.recognitions')}</th>
                <th className={head}>{t('hrOverview.followUps')}</th>
                <th className={head}>{t('hrOverview.agreements')}</th>
                <th className={head}>{t('hrOverview.lastEvaluation')}</th>
                <th className={head}>{t('hrOverview.nextEvaluation')}</th>
                <th className={head}>{t('hrOverview.training')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.workerId} className="hover:bg-surface-2/60">
                  <td className="px-2.5 py-2">
                    <Link href={`/hr/${r.workerId}`} className="font-medium hover:text-accent hover:underline">{r.name}</Link>
                    <span className="block text-[11.5px] text-muted">{t(teamLabelKey(r.team as Team))}</span>
                  </td>
                  <td className={cell} title={t('hrOverview.lateHint')}>
                    <N n={r.lateUnexcused} tone="late" /> <span className="text-subtle">/ {r.late}</span>
                  </td>
                  <td className={cell}><N n={r.early} tone="warn" /></td>
                  <td className={cell}>
                    <N n={r.warnings} tone="late" />
                    {r.worstWarning && <span className="ml-1 text-[11.5px] text-muted">({level(r.worstWarning)})</span>}
                  </td>
                  <td className={cell}><N n={r.recognitions} tone="done" /></td>
                  <td className={cell}><N n={r.openFollowUps} tone="warn" /></td>
                  <td className={cell}><N n={r.agreementsNotMet} tone="late" /></td>
                  <td className={cell}>
                    {r.lastEvaluation ? formatDate(r.lastEvaluation, 'medium') : <span className="text-subtle">—</span>}
                    {r.lastScore !== null && <span className="ml-1 text-[11.5px] text-muted">Ø {r.lastScore.toFixed(1)}</span>}
                  </td>
                  <td className={cn(cell, r.nextEvaluation && r.nextEvaluation < today && 'font-medium text-late')}>
                    {r.nextEvaluation ? formatDate(r.nextEvaluation, 'medium') : <span className="text-subtle">—</span>}
                  </td>
                  <td className={cell}><N n={r.trainingGaps} tone="late" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
