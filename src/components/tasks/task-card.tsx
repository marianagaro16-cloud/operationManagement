'use client';

import { useState, useTransition } from 'react';
import { Check, MessageSquare, RotateCcw, SkipForward, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, ErrorState } from '@/components/ui/primitives';
import { completeOccurrence, reopenOccurrence } from '@/server/actions';
import { daysLate } from '@/domain/recurrence/engine';
import { SkipDialog } from './skip-dialog';
import { CommentThread } from './comment-thread';
import type { OccurrenceWithTask } from '@/types/database';

interface Props {
  occurrence: OccurrenceWithTask;
  today: string;
  /** Show the original due date — used in the overdue section. */
  showDueDate?: boolean;
}

export function TaskCard({ occurrence, today, showDueDate }: Props) {
  const { t, formatDate } = useI18n();
  const [pending, startTransition] = useTransition();
  const [skipOpen, setSkipOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optimistic: the checkbox flips immediately, then reconciles with the
  // server. Completing a task is the single most repeated action in the app,
  // so it must feel instant.
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const status = optimisticStatus ?? occurrence.status;

  const due = occurrence.due_date_override ?? occurrence.due_date;
  const isOverdue = status === 'pending' && due < today;
  const late = isOverdue ? daysLate(due, today) : 0;
  const isDone = status === 'completed';
  const isSkipped = status === 'skipped';
  const resolved = isDone || isSkipped;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, optimistic: string) {
    setError(null);
    setOptimisticStatus(optimistic);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setOptimisticStatus(null); // roll back
        setError(translateError(res.error));
      } else {
        setOptimisticStatus(null); // let the refreshed server data win
      }
    });
  }

  function translateError(code?: string) {
    switch (code) {
      case 'skip_reason_required': return t('task.skipReasonRequired');
      case 'task_not_skippable': return t('task.notSkippable');
      case 'not_authorized':
      case 'not_your_action': return t('common.error');
      default: return code ?? t('common.error');
    }
  }

  return (
    <li
      className={cn(
        'rounded-xl border bg-surface shadow-card transition-colors',
        isOverdue ? 'border-late/30' : 'border-border',
        resolved && 'bg-surface-2/40',
      )}
    >
      <div className="flex gap-3 p-3 sm:p-3.5">
        {/* Completion control — large hit target, instant feedback. */}
        <button
          onClick={() =>
            isDone
              ? run(() => reopenOccurrence(occurrence.id), 'pending')
              : run(() => completeOccurrence(occurrence.id), 'completed')
          }
          disabled={pending}
          aria-label={isDone ? t('task.reopen') : t('task.complete')}
          aria-pressed={isDone}
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all',
            isDone
              ? 'border-done bg-done text-white'
              : isSkipped
                ? 'border-skipped/40 text-skipped'
                : 'border-border hover:border-done hover:bg-done/5',
            pending && 'opacity-60',
          )}
        >
          {isDone && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
          {isSkipped && <SkipForward className="h-3 w-3" aria-hidden />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p
              className={cn(
                'text-[14px] font-medium leading-snug',
                resolved && 'text-muted line-through decoration-subtle',
              )}
            >
              {occurrence.task.title}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Badge tone="neutral">{t(`frequency.${occurrence.task.frequency}` as 'frequency.daily')}</Badge>
              {isOverdue && (
                <Badge tone="late">
                  <TriangleAlert className="h-2.5 w-2.5" aria-hidden />
                  {late === 1 ? t('task.overdueByOne') : t('task.overdueBy', { days: late })}
                </Badge>
              )}
              {isDone && <Badge tone="done">{t('status.completed')}</Badge>}
              {isSkipped && <Badge tone="skipped">{t('status.skipped')}</Badge>}
            </div>
          </div>

          {occurrence.task.description && !resolved && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              {occurrence.task.description}
            </p>
          )}

          {/* Weekly tasks need their completion-window rule made explicit. */}
          {occurrence.task.frequency === 'weekly' && !resolved && (
            <p className="mt-1 text-[12px] text-subtle">{t('task.weeklyHint')}</p>
          )}

          {showDueDate && (
            <p className="mt-1 text-[12px] tabular text-muted">
              {t('task.due', { date: formatDate(due, 'medium') })}
            </p>
          )}

          {isSkipped && occurrence.skip_reason && (
            <p className="mt-1.5 rounded-md bg-surface-2 px-2 py-1 text-[12px] text-muted">
              <span className="font-medium">{t('task.skipReason')}:</span> {occurrence.skip_reason}
            </p>
          )}

          {error && <div className="mt-2"><ErrorState message={error} /></div>}

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {!resolved && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => run(() => completeOccurrence(occurrence.id), 'completed')}
                disabled={pending}
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                {t('task.complete')}
              </Button>
            )}

            {!resolved && occurrence.task.is_skippable && (
              <Button size="sm" variant="ghost" onClick={() => setSkipOpen(true)} disabled={pending}>
                <SkipForward className="h-3.5 w-3.5" aria-hidden />
                {t('task.skip')}
              </Button>
            )}

            {resolved && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => run(() => reopenOccurrence(occurrence.id), 'pending')}
                disabled={pending}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {t('task.reopen')}
              </Button>
            )}

            <Button size="sm" variant="ghost" onClick={() => setCommentsOpen((v) => !v)}>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              {t('task.comment')}
            </Button>
          </div>

          {commentsOpen && (
            <CommentThread occurrenceId={occurrence.id} taskId={occurrence.task_id} />
          )}
        </div>
      </div>

      <SkipDialog
        open={skipOpen}
        onClose={() => setSkipOpen(false)}
        occurrenceId={occurrence.id}
        onError={(e) => setError(translateError(e))}
      />
    </li>
  );
}
