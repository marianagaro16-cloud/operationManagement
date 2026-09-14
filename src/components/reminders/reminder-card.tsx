'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/primitives';
import { reminderPhase } from '@/domain/reminders/schedule';
import type { Reminder } from '@/types/reminders';
import { LinkChip, PhaseBadge, RecurrenceBadge, SharingLine, useFormatMoment } from './reminder-bits';
import { QuickActions } from './reminder-actions';

/**
 * One reminder in a list.
 *
 * The visual weight follows the phase: overdue carries a red rule and bold
 * time, today an accent rule, upcoming nothing, and closed reminders are
 * muted — scanning a list should find the late ones without reading it.
 */
export function ReminderCard({
  reminder,
  viewerId,
  nowIso,
  compact = false,
}: {
  reminder: Reminder;
  viewerId: string;
  nowIso: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const format = useFormatMoment();
  const phase = reminderPhase(reminder.status, reminder.next_at, nowIso, reminder.timezone);
  const closed = reminder.status !== 'open';

  return (
    <Card
      className={cn(
        'border-l-[3px] px-3.5 py-3',
        phase === 'overdue' ? 'border-l-late' : phase === 'today' ? 'border-l-accent' : 'border-l-transparent',
        closed && 'opacity-75',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <Link href={`/reminders/${reminder.id}`} className="min-w-0 flex-1 group">
          <p className={cn('text-[14px] font-medium leading-snug group-hover:underline', closed && 'text-muted')}>
            {reminder.title}
          </p>
          <p className={cn('mt-0.5 text-[12.5px] tabular', phase === 'overdue' ? 'font-semibold text-late' : 'text-muted')}>
            {format(reminder.next_at, reminder.timezone)}
            {reminder.snoozed_until && !closed && (
              <span className="ml-1.5 font-normal text-subtle">
                · {t('reminder.originallyDue', { time: format(reminder.due_at, reminder.timezone) })}
              </span>
            )}
          </p>
        </Link>
        <div className="flex flex-wrap items-center gap-1">
          <PhaseBadge phase={phase} />
          <RecurrenceBadge recurrence={reminder.recurrence} />
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <SharingLine
          isShared={reminder.is_shared}
          participants={reminder.participants}
          viewerId={viewerId}
          compact={compact}
        />
        <LinkChip row={reminder} />
      </div>

      {!closed && (
        <div className="mt-2.5">
          <QuickActions reminder={reminder} />
        </div>
      )}
    </Card>
  );
}
