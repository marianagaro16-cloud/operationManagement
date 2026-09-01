'use client';

import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/i18n';
import { EmptyState, Progress, SectionHeading } from '@/components/ui/primitives';
import { TaskCard } from './task-card';
import { ExtraTasksBanner } from './extra-tasks-banner';
import type { DashboardData } from '@/server/data';

/**
 * The dashboard answers three questions in priority order:
 *   1. What do I need to do today?
 *   2. What am I overdue on?
 *   3. Is there additional recurring work I might miss?
 *
 * Overdue sits above today's list because unfinished past work is the more
 * urgent signal; the extra-task banner sits above everything because missing
 * it is the costliest mistake.
 */
export function DashboardView({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const { today, dailyToday, extraToday, overdue, upcoming } = data;

  const todayAll = [...dailyToday, ...extraToday];
  const done = todayAll.filter((o) => o.status !== 'pending').length;
  const total = todayAll.length;

  return (
    <div className="space-y-7">
      <ExtraTasksBanner
        count={extraToday.length}
        frequencies={extraToday.map((o) => o.task.frequency)}
      />

      {/* ---------------- overdue ---------------- */}
      {overdue.length > 0 && (
        <section>
          <SectionHeading
            title={t('dashboard.overdueTitle')}
            subtitle={t('dashboard.overdueSubtitle')}
            action={
              <span className="inline-flex items-center gap-1 rounded-md bg-late/10 px-1.5 py-0.5 text-2xs font-medium text-late">
                <TriangleAlert className="h-2.5 w-2.5" aria-hidden />
                {overdue.length}
              </span>
            }
          />
          <ul className="space-y-2">
            {overdue.map((o) => (
              <TaskCard key={o.id} occurrence={o} today={today} showDueDate />
            ))}
          </ul>
        </section>
      )}

      {/* ---------------- today ---------------- */}
      <section>
        <SectionHeading title={t('dashboard.todayTitle')} subtitle={t('dashboard.todaySubtitle')} />

        {total > 0 && (
          <div className="mb-3 rounded-xl border border-border bg-surface p-3.5 shadow-card">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-medium tabular">
                {t('dashboard.progress', { done, total })}
              </span>
              <span className="text-[13px] font-semibold tabular text-muted">
                {Math.round((done / total) * 100)}%
              </span>
            </div>
            <Progress value={done} total={total} />
          </div>
        )}

        {dailyToday.length === 0 && extraToday.length === 0 ? (
          <EmptyState title={t('dashboard.noTasksToday')} body={t('dashboard.noTasksTodayBody')} />
        ) : done === total ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5 text-done" aria-hidden />}
            title={t('dashboard.allDone')}
            body={t('dashboard.allDoneBody')}
          />
        ) : null}

        {dailyToday.length > 0 && (
          <ul className="space-y-2">
            {dailyToday.map((o) => (
              <TaskCard key={o.id} occurrence={o} today={today} />
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- additional recurring today ---------------- */}
      {extraToday.length > 0 && (
        <section id="extra-tasks" className="scroll-mt-20">
          <SectionHeading title={t('dashboard.extraSectionTitle')} />
          <ul className="space-y-2">
            {extraToday.map((o) => (
              <TaskCard key={o.id} occurrence={o} today={today} />
            ))}
          </ul>
        </section>
      )}

      {/* ---------------- upcoming ---------------- */}
      <section>
        <SectionHeading title={t('dashboard.upcomingTitle')} subtitle={t('dashboard.upcomingSubtitle')} />
        {upcoming.length === 0 ? (
          <EmptyState title={t('dashboard.noUpcoming')} />
        ) : (
          <ul className="space-y-2 opacity-90">
            {upcoming.slice(0, 12).map((o) => (
              <TaskCard key={o.id} occurrence={o} today={today} showDueDate />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
