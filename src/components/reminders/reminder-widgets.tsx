'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Bell, ChevronRight, ListTodo, Sparkles } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Card, Progress } from '@/components/ui/primitives';
import { isOnDay, personalTaskPhase } from '@/domain/reminders/schedule';
import type { PersonalTask, Reminder } from '@/types/reminders';
import { QuickReminderButton } from './reminder-actions';
import { useFormatMoment } from './reminder-bits';
import { PersonalTaskDialog, QuickAdd, TaskRow } from './personal-tasks';

/** Rows the dashboard card shows before it hands over to the full page. */
const CARD_ROWS = 5;

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
  tasks: { open: PersonalTask[]; closed: PersonalTask[] };
  nowIso: string;
}) {
  const { t } = useI18n();
  const format = useFormatMoment();

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

      <PersonalTasksCard open={tasks.open} closed={tasks.closed} nowIso={nowIso} />
    </div>
  );
}

/**
 * The full page's checklist, in a card: tick what is due now, add a line for
 * today, and see today's progress. Only what is overdue or due today is
 * listed — anything later waits on the full page, which the header opens.
 */
function PersonalTasksCard({
  open,
  closed,
  nowIso,
}: {
  open: PersonalTask[];
  closed: PersonalTask[];
  nowIso: string;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<PersonalTask | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const today = DateTime.fromISO(nowIso).setZone(BUSINESS_TZ).toISODate()!;

  const due = open
    .map((task) => ({ task, phase: personalTaskPhase(task.status, task.due_date, task.due_time, nowIso) }))
    .filter((x): x is { task: PersonalTask; phase: 'overdue' | 'today' } => x.phase === 'overdue' || x.phase === 'today')
    // Overdue first; the query already orders each by date and time.
    .sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'overdue' ? -1 : 1));
  const doneToday = closed.filter((c) => c.status === 'completed' && isOnDay(c.completed_at, today)).length;
  const hidden = due.length - CARD_ROWS;

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="px-3.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/reminders/tasks" className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold hover:underline">
            <ListTodo className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            <span className="truncate">{t('ptask.widgetTitle')}</span>
            {due.length > 0 && (
              <span className="shrink-0 rounded-full bg-accent/15 px-1.5 text-[11px] font-medium tabular text-accent">
                {t('ptask.widgetDue', { count: due.length })}
              </span>
            )}
          </Link>
          <Link
            href="/reminders/tasks"
            aria-label={t('ptask.viewAll')}
            className="-mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        {due.length + doneToday > 0 && (
          <div className="mt-2 flex items-center gap-2.5">
            <div className="flex-1">
              <Progress value={doneToday} total={doneToday + due.length} />
            </div>
            <span className="shrink-0 text-[11.5px] tabular text-muted">
              {t('ptask.heroDone', { count: doneToday })}
            </span>
          </div>
        )}

        <div className="my-2.5">
          <QuickAdd compact today={today} onDetails={(title) => setCreating(title)} />
        </div>
      </div>

      {due.length === 0 ? (
        <p className="flex items-center gap-2 border-t border-border px-3.5 py-3 text-[12.5px] text-muted">
          {doneToday > 0 && <Sparkles className="h-4 w-4 text-done" aria-hidden />}
          {doneToday > 0 ? t('ptask.heroAllDone') : t('ptask.widgetNothing')}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {due.slice(0, CARD_ROWS).map(({ task, phase }) => (
            <TaskRow key={task.id} compact task={task} group={phase} today={today} onEdit={() => setEditing(task)} />
          ))}
        </ul>
      )}

      {hidden > 0 && (
        <Link
          href="/reminders/tasks"
          className="border-t border-border px-3.5 py-2 text-[12.5px] font-medium text-muted transition-colors hover:bg-surface-2/60 hover:text-accent"
        >
          {t('ptask.widgetMore', { count: hidden })}
        </Link>
      )}

      {(creating !== null || editing) && (
        <PersonalTaskDialog
          task={editing}
          initialTitle={creating ?? ''}
          onClose={() => { setCreating(null); setEditing(null); }}
        />
      )}
    </Card>
  );
}
