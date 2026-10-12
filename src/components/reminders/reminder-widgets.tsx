'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Bell, ListTodo } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Card } from '@/components/ui/primitives';
import { isOnDay, personalTaskPhase } from '@/domain/reminders/schedule';
import type { PersonalTask, Reminder } from '@/types/reminders';
import { QuickReminderButton } from './reminder-actions';
import { useFormatMoment } from './reminder-bits';
import { PersonalTaskDialog } from './personal-tasks';
import { NewTask, TaskLine } from '@/components/space/task-list';

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
    // Two tiles of the dashboard grid, each placed on its own.
    <>
      <div className="mb-4 break-inside-avoid">
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
      </div>

      <div className="mb-4 break-inside-avoid">
        <PersonalTasksCard open={tasks.open} closed={tasks.closed} nowIso={nowIso} />
      </div>
    </>
  );
}

/**
 * Today's personal tasks on Inicio, as the same plain lines as in Mi espacio:
 * tick what is due, change it on the line, write a new one at the end. Only
 * what is late or due today is listed — the rest is in Mi espacio, which the
 * title opens.
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

  const today = DateTime.fromISO(nowIso).setZone(BUSINESS_TZ).toISODate()!;

  const due = open
    .map((task) => ({ task, phase: personalTaskPhase(task.status, task.due_date, task.due_time, nowIso) }))
    .filter((x): x is { task: PersonalTask; phase: 'overdue' | 'today' } => x.phase === 'overdue' || x.phase === 'today')
    // Overdue first; the query already orders each by date and time.
    .sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'overdue' ? -1 : 1));
  const doneToday = closed.filter((c) => c.status === 'completed' && isOnDay(c.completed_at, today)).length;
  const hidden = due.length - CARD_ROWS;

  return (
    <Card className="px-2.5 py-3">
      <Link href="/space/tasks" className="mb-1 flex items-center gap-1.5 px-1 text-[13.5px] font-semibold hover:underline">
        <ListTodo className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 truncate">{t('ptask.widgetTitle')}</span>
        <span className="ml-auto shrink-0 text-[12px] font-normal tabular text-subtle">
          {due.length > 0 ? t('ptask.widgetDue', { count: due.length }) : doneToday > 0 ? t('ptask.heroDone', { count: doneToday }) : ''}
        </span>
      </Link>

      <ul>
        {due.slice(0, CARD_ROWS).map(({ task, phase }) => (
          <TaskLine key={task.id} compact task={task} group={phase} today={today} onDetails={() => setEditing(task)} />
        ))}
      </ul>
      <NewTask date={today} />

      {hidden > 0 && (
        <Link href="/space/tasks" className="mt-1 block px-1 text-[12.5px] text-muted hover:text-fg hover:underline">
          {t('ptask.widgetMore', { count: hidden })}
        </Link>
      )}

      {editing && <PersonalTaskDialog task={editing} initialTitle="" onClose={() => setEditing(null)} />}
    </Card>
  );
}
