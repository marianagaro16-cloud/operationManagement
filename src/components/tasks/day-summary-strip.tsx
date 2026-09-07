'use client';

import { CheckCircle2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/primitives';

/**
 * One answer to "am I done for the day".
 *
 * The dashboard is five widgets that each decide independently whether to
 * render, and none of them could see the others. The only percentage on the
 * page came from today's TASKS alone, so "Everything for today is done" could
 * sit above an untouched inventory count and six unprepared orders — the
 * screen's most prominent claim was the one it was least able to make.
 *
 * This does not replace those widgets. It sits above them and reconciles what
 * they each already know, from figures the page has already fetched.
 *
 * A stream with nothing in it today is omitted rather than shown as 0/0: that
 * is true but noisy, and it would also make the strip claim the day is clear
 * on the strength of work that does not exist. A viewer with no orders and no
 * counts sees a strip about their tasks, which is honestly their whole day.
 */

interface Count {
  done: number;
  total: number;
}

export function DaySummaryStrip({
  tasks,
  prepare,
  counts,
}: {
  tasks: Count;
  prepare: Count;
  counts: Count;
}) {
  const { t } = useI18n();

  const streams = [
    { label: t('dashboard.streamTasks'), ...tasks },
    { label: t('dashboard.streamPrepare'), ...prepare },
    { label: t('dashboard.streamCounts'), ...counts },
  ].filter((s) => s.total > 0);

  if (streams.length === 0) return null;

  const allClear = streams.every((s) => s.done >= s.total);

  return (
    <Card
      className={cn(
        'mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-3.5 py-3',
        allClear && 'border-done/30 bg-done/[0.05]',
      )}
    >
      {allClear && (
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-done">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {t('dashboard.dayClear')}
        </span>
      )}

      {streams.map((s) => (
        <span key={s.label} className="flex items-baseline gap-1.5 text-[13px]">
          <span className="text-muted">{s.label}</span>
          <span
            className={cn(
              'font-semibold tabular',
              s.done >= s.total ? 'text-done' : 'text-fg',
            )}
          >
            {s.done}/{s.total}
          </span>
        </span>
      ))}
    </Card>
  );
}
