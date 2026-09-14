'use client';

import Link from 'next/link';
import { Bell, ListTodo } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/primitives';
import { personalTaskPhase } from '@/domain/reminders/schedule';
import type { PersonalTask, Reminder } from '@/types/reminders';
import { QuickReminderButton } from './reminder-actions';
import { useFormatMoment } from './reminder-bits';

/**
 * My reminders and my personal tasks, on the dashboard.
 *
 * Two separate cards with their own counts, and neither added to the day
 * summary strip: that strip counts operational work, and a personal to-do or
 * a reminder counted into "Tasks 3 / 7" would make the team's number lie.
 */
export function ReminderWidgets({
  viewerId,
  reminders,
  tasks,
  nowIso,
}: {
  viewerId: string;
  reminders: { overdue: Reminder[]; overdueTotal: number; today: Reminder[]; upcoming: Reminder[] };
  tasks: PersonalTask[];
  nowIso: string;
}) {
  const { t, formatDate } = useI18n();
  const format = useFormatMoment();

  const dueTasks = tasks
    .map((task) => ({ task, phase: personalTaskPhase(task.status, task.due_date, task.due_time, nowIso) }))
    .filter(({ phase }) => phase === 'overdue' || phase === 'today');

  const reminderRows = [
    ...reminders.overdue.map((r) => ({ r, late: true })),
    ...reminders.today.map((r) => ({ r, late: false })),
  ];

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
      <Card className="px-3.5 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Link href="/reminders" className="flex items-center gap-1.5 text-[13.5px] font-semibold hover:underline">
            <Bell className="h-4 w-4 text-muted" aria-hidden />
            {t('reminder.widgetTitle')}
            {reminders.overdueTotal > 0 && (
              <span className="rounded-full bg-late/15 px-1.5 text-[11px] font-medium tabular text-late">
                {t('reminder.widgetOverdue', { count: reminders.overdueTotal })}
              </span>
            )}
          </Link>
          <QuickReminderButton viewerId={viewerId} variant="ghost" />
        </div>

        {reminderRows.length === 0 && reminders.upcoming.length === 0 ? (
          <p className="py-2 text-[12.5px] text-muted">{t('reminder.widgetNothing')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {reminderRows.map(({ r, late }) => (
              <li key={r.id}>
                <Link href={`/reminders/${r.id}`} className="flex items-baseline justify-between gap-3 py-1.5 text-[13px] hover:text-accent">
                  <span className="min-w-0 truncate">{r.title}</span>
                  <span className={cn('shrink-0 text-[12px] tabular', late ? 'font-semibold text-late' : 'text-muted')}>
                    {late ? format(r.next_at, r.timezone) : format(r.next_at, r.timezone, 'time')}
                  </span>
                </Link>
              </li>
            ))}
            {reminders.upcoming.map((r) => (
              <li key={r.id}>
                <Link href={`/reminders/${r.id}`} className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px] text-muted hover:text-accent">
                  <span className="min-w-0 truncate">{r.title}</span>
                  <span className="shrink-0 tabular text-subtle">{format(r.next_at, r.timezone)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="px-3.5 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Link href="/reminders/tasks" className="flex items-center gap-1.5 text-[13.5px] font-semibold hover:underline">
            <ListTodo className="h-4 w-4 text-muted" aria-hidden />
            {t('ptask.widgetTitle')}
            {dueTasks.length > 0 && (
              <span className="rounded-full bg-accent/15 px-1.5 text-[11px] font-medium tabular text-accent">
                {t('ptask.widgetDue', { count: dueTasks.length })}
              </span>
            )}
          </Link>
        </div>
        {dueTasks.length === 0 ? (
          <p className="py-2 text-[12.5px] text-muted">{t('ptask.widgetNothing')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {dueTasks.slice(0, 6).map(({ task, phase }) => (
              <li key={task.id}>
                <Link href="/reminders/tasks" className="flex items-baseline justify-between gap-3 py-1.5 text-[13px] hover:text-accent">
                  <span className="min-w-0 truncate">{task.title}</span>
                  <span className={cn('shrink-0 text-[12px] tabular', phase === 'overdue' ? 'font-semibold text-late' : 'text-muted')}>
                    {phase === 'overdue' ? formatDate(task.due_date!, 'short') : task.due_time?.slice(0, 5) ?? ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
