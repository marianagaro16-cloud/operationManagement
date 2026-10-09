'use client';

import { useState, useTransition } from 'react';
import { DateTime } from 'luxon';
import { Ban, Check, Factory, MessageSquare, RotateCcw, SkipForward, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Badge, ErrorState } from '@/components/ui/primitives';
import { StatusChip } from '@/components/ui/status-chip';
import { NoteText } from '@/components/ui/note';
import { completeOccurrence, reopenOccurrence } from '@/server/actions';
import { daysLate } from '@/domain/recurrence/engine';
import { localizedTitle, localizedDescription } from '@/lib/localized-content';
import { SkipDialog } from './skip-dialog';
import { BlockDialog } from './block-dialog';
import { CommentComposer, TaskComments } from './comment-thread';
import { ProductionDialog, ProductionSummary, ProductionTargetButton } from './production-dialog';
import type { OccurrenceWithTask } from '@/types/database';

interface Props {
  occurrence: OccurrenceWithTask;
  today: string;
  /** Show the original due date — used in the overdue and upcoming sections. */
  showDueDate?: boolean;
  /** Say whose copy this is — for planners, who see everyone's. */
  showAssignee?: boolean;
  /** Skipping is a manager's decision; everyone else can only block. */
  canSkip?: boolean;
}

export function TaskCard({ occurrence, today, showDueDate, showAssignee, canSkip }: Props) {
  const { t, locale, formatDate } = useI18n();
  const [pending, startTransition] = useTransition();
  const [skipOpen, setSkipOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // A production order: completed by recording what was made.
  const [recording, setRecording] = useState(false);
  const production = occurrence.task.product_id && occurrence.task.target_quantity
    ? {
        product_name: occurrence.task.product?.name ?? '—',
        // This day's quantity when set, otherwise the usual one.
        target_quantity: Number(occurrence.target_quantity ?? occurrence.task.target_quantity),
        record: occurrence.production ?? null,
      }
    : null;
  const [error, setError] = useState<string | null>(null);

  // Optimistic: the card flips immediately, then reconciles with the server.
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const status = optimisticStatus ?? occurrence.status;

  const due = occurrence.effective_due_date;
  // Blocked work is still owed: once its day has passed it is late like any
  // other, with the reason beside it.
  const isBlocked = status === 'blocked';
  const isOverdue = (status === 'pending' || isBlocked) && due < today;
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
        setOptimisticStatus(null); // let refreshed server data win
      }
    });
  }

  function translateError(code?: string) {
    switch (code) {
      case 'skip_reason_required': return t('task.skipReasonRequired');
      case 'task_not_skippable': return t('task.notSkippable');
      case 'not_your_action': return t('task.notYourAction');
      case 'not_assigned_to_you': return t('task.notAssignedToYou');
      case 'not_your_team': return t('task.notYourTeam');
      case 'block_reason_required': return t('task.blockReasonRequired');
      case 'not_authorized': return t('common.error');
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
      <div className="p-3 sm:p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p
            className={cn(
              'min-w-0 flex-1 text-[14px] font-medium leading-snug',
              resolved && 'text-muted line-through decoration-subtle',
            )}
          >
            {localizedTitle(occurrence.task, locale)}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Badge tone="neutral">
              {t(`frequency.${occurrence.task.frequency}` as 'frequency.daily')}
            </Badge>
            {isOverdue && (
              <Badge tone="late">
                <TriangleAlert className="h-2.5 w-2.5" aria-hidden />
                {late === 1 ? t('task.overdueByOne') : t('task.overdueBy', { days: late })}
              </Badge>
            )}
            {/* Label and tone from the shared registry. */}
            {isDone && <StatusChip domain="task" status="completed" />}
            {isSkipped && <StatusChip domain="task" status="skipped" />}
            {isBlocked && <StatusChip domain="task" status="blocked" />}
          </div>
        </div>

        {!resolved && localizedDescription(occurrence.task, locale) && (
          <div className="mt-1 text-[12.5px] leading-relaxed text-muted">
            <NoteText text={localizedDescription(occurrence.task, locale)} />
          </div>
        )}

        {showAssignee && occurrence.assignee_name && (
          <p className="mt-1 text-[12px] text-muted">
            {t('plan.assignee')}: {occurrence.assignee_name}
          </p>
        )}

        {showDueDate && (
          <p className="mt-1 text-[12px] tabular text-muted">
            {t('task.due', { date: formatDate(due, 'medium') })}
          </p>
        )}

        {/* Who finished it, and when. "It's done" was answered; "who did it" —
            the question a handover actually asks — was not, even though the
            phrasing for it has been translated all along. */}
        {resolved && occurrence.actor_name && (
          <p className="mt-1 text-[12px] text-subtle">
            {(isDone ? t('task.completedBy', { name: occurrence.actor_name })
                     : t('task.skippedBy', { name: occurrence.actor_name }))}
            {/* Someone else's, resolved while covering them: whose it stays. */}
            {occurrence.covered_assignment_id && occurrence.assignee_name && (
              <> {t('coverage.coveringFor', { name: occurrence.assignee_name })}</>
            )}
            {occurrence.resolved_at && (
              <span className="tabular">
                {' · '}
                {DateTime.fromISO(occurrence.resolved_at)
                  .setZone(BUSINESS_TZ)
                  .setLocale(locale)
                  .toFormat('d LLL, HH:mm')}
              </span>
            )}
          </p>
        )}

        {isSkipped && occurrence.skip_reason && (
          <div className="mt-1.5 rounded-md bg-surface-2 px-2 py-1 text-[12px] text-muted">
            <span className="font-medium">{t('task.skipReason')}:</span>{' '}
            <NoteText text={occurrence.skip_reason} />
          </div>
        )}

        {isBlocked && occurrence.blocked_reason && (
          <div className="mt-1.5 rounded-md border border-warn/25 bg-warn/[0.06] px-2 py-1 text-[12px] text-fg">
            <span className="font-medium">{t('task.blockReason')}</span>{' '}
            <NoteText text={occurrence.blocked_reason} />
          </div>
        )}

        {production && !production.record && (
          <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-[12px] font-medium text-accent">
            <Factory className="h-3.5 w-3.5" aria-hidden />
            {t('production.target', { target: production.target_quantity, product: production.product_name })}
            {/* Whoever plans sets this day's quantity. */}
            {canSkip && !resolved && (
              <ProductionTargetButton occurrenceId={occurrence.id} current={production.target_quantity} />
            )}
          </p>
        )}
        {production?.record && <ProductionSummary record={production.record} />}

        {/* Comments, always visible and in the note colour. */}
        <TaskComments comments={occurrence.comments ?? []} />

        {error && <div className="mt-2"><ErrorState message={error} /></div>}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {!resolved && production && (
            <Button size="sm" variant="success" onClick={() => setRecording(true)} disabled={pending}>
              <Factory className="h-3.5 w-3.5" aria-hidden />
              {t('production.record')}
            </Button>
          )}
          {!resolved && !production && (
            <Button
              size="sm"
              variant="success"
              onClick={() => run(() => completeOccurrence(occurrence.id), 'completed')}
              loading={pending}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              {t('task.complete')}
            </Button>
          )}

          {canSkip && !resolved && !isBlocked && occurrence.task.is_skippable && (
            <Button size="sm" variant="ghost" onClick={() => setSkipOpen(true)} disabled={pending}>
              <SkipForward className="h-3.5 w-3.5" aria-hidden />
              {t('task.skip')}
            </Button>
          )}

          {/* Deliberately NOT gated on is_skippable. Declining to do a task and
              being unable to do it are different statements, and a task nobody
              is allowed to skip is exactly the one that must not rot silently
              in the overdue list. */}
          {!resolved && !isBlocked && (
            <Button size="sm" variant="ghost" onClick={() => setBlockOpen(true)} disabled={pending}>
              <Ban className="h-3.5 w-3.5" aria-hidden />
              {t('task.block')}
            </Button>
          )}

          {/* Undo. Always offered on a resolved occurrence so a mistaken tap
              is one click away from being reversed. */}
          {(resolved || isBlocked) && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => run(() => reopenOccurrence(occurrence.id), 'pending')}
              loading={pending}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t('task.undo')}
            </Button>
          )}

          <Button size="sm" variant="ghost" onClick={() => setCommentsOpen((v) => !v)}>
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            {t('task.comment')}
          </Button>
        </div>

        {recording && production && (
          <ProductionDialog occurrenceId={occurrence.id} known={production} onClose={() => setRecording(false)} />
        )}

        {commentsOpen && (
          <CommentComposer
            occurrenceId={occurrence.id}
            taskId={occurrence.task_id}
            onPosted={() => setCommentsOpen(false)}
          />
        )}
      </div>

      <SkipDialog
        open={skipOpen}
        onClose={() => setSkipOpen(false)}
        occurrenceId={occurrence.id}
        onError={(e) => setError(translateError(e))}
      />

      <BlockDialog
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        occurrenceId={occurrence.id}
        onError={(e) => setError(translateError(e))}
      />
    </li>
  );
}
