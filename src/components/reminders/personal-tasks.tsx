'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, CalendarDays, Check, CheckCircle2, ChevronDown, Pencil, Plus, RotateCcw, SlidersHorizontal, Sparkles, Target, XCircle } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, EmptyState, ErrorState, Field, Input, Progress, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { daysFromToday, isOnDay, personalTaskPhase } from '@/domain/reminders/schedule';
import { LINK_COLUMN, LINK_TYPES, type LinkType } from '@/domain/reminders/links';
import { savePersonalTask, setPersonalTaskStatus } from '@/server/reminder-actions';
import type { PersonalTask } from '@/types/reminders';
import { LinkChip, reminderErrorKey } from './reminder-bits';

export type Group = 'overdue' | 'today' | 'upcoming' | 'undated';

const GROUPS: { key: Group; label: MessageKey; dot: string }[] = [
  { key: 'overdue', label: 'ptask.groupOverdue', dot: 'bg-late' },
  { key: 'today', label: 'ptask.groupToday', dot: 'bg-accent' },
  { key: 'upcoming', label: 'ptask.groupUpcoming', dot: 'bg-subtle' },
  { key: 'undated', label: 'ptask.groupUndated', dot: 'bg-border' },
];

/**
 * Personal Tasks.
 *
 * A to-do list that is nobody's business but the owner's. It lives beside
 * Reminders, not beside Tasks, so it can never be mistaken for operational
 * work — and it is read from its own table, so no operational screen,
 * statistic or report could include it even by accident.
 *
 * Built like a checklist rather than a list of records: a round box to tick,
 * the task, and when it is due. Everything else — date, notes, cancelling —
 * is one tap away in the task itself, so the screen is not three buttons
 * repeated down every row. Adding is a line at the top that takes Enter.
 */
export function PersonalTaskList({
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
  const [showClosed, setShowClosed] = useState(false);

  const today = DateTime.fromISO(nowIso).setZone(BUSINESS_TZ).toISODate()!;

  const groups: Record<Group, PersonalTask[]> = { overdue: [], today: [], upcoming: [], undated: [] };
  for (const task of open) {
    const phase = personalTaskPhase(task.status, task.due_date, task.due_time, nowIso);
    if (phase in groups) groups[phase as Group].push(task);
  }

  // Today's progress: what is still due now against what was ticked off today.
  const dueNow = groups.overdue.length + groups.today.length;
  const doneToday = closed.filter((c) => c.status === 'completed' && isOnDay(c.completed_at, today)).length;

  return (
    <>
      <Link href="/reminders" className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('reminder.title')}
      </Link>

      <PageHeader title={t('ptask.title')} subtitle={t('ptask.subtitle')} />

      {dueNow + doneToday > 0 && (
        <Card className="mb-3 flex items-center gap-3.5 overflow-hidden p-4">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
              dueNow === 0 ? 'bg-done/10 text-done' : 'bg-accent/10 text-accent',
            )}
          >
            {dueNow === 0 ? <Sparkles className="h-5 w-5" aria-hidden /> : <Target className="h-5 w-5" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight">
              {dueNow === 0 ? t('ptask.heroAllDone') : t('ptask.heroLeft', { count: dueNow })}
            </p>
            <p className="mb-2 mt-0.5 text-[12.5px] text-muted">{t('ptask.heroDone', { count: doneToday })}</p>
            <Progress value={doneToday} total={doneToday + dueNow} />
          </div>
        </Card>
      )}

      <QuickAdd today={today} onDetails={(title) => setCreating(title)} />

      {open.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6 text-done" aria-hidden />}
            title={t('ptask.empty')}
            body={t('ptask.emptyBody')}
          />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {GROUPS.map(({ key, label, dot }) =>
            groups[key].length === 0 ? null : (
              <section key={key}>
                <h2 className="mb-2 flex items-center gap-2 px-0.5 text-[13px] font-semibold">
                  <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />
                  {t(label)}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11px] font-semibold tabular',
                      key === 'overdue' ? 'bg-late/10 text-late' : 'bg-surface-2 text-muted',
                    )}
                  >
                    {groups[key].length}
                  </span>
                </h2>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-border">
                    {groups[key].map((task) => (
                      <TaskRow key={task.id} task={task} group={key} today={today} onEdit={() => setEditing(task)} />
                    ))}
                  </ul>
                </Card>
              </section>
            ),
          )}
        </div>
      )}

      {closed.length > 0 && (
        <section className="mt-7">
          <button
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
            className="flex w-full items-center gap-2 rounded-lg px-0.5 py-1 text-left text-[13px] font-semibold text-muted transition-colors hover:text-fg"
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', !showClosed && '-rotate-90')} aria-hidden />
            {t('ptask.groupClosed')}
            <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular">{closed.length}</span>
          </button>
          {showClosed && (
            <Card className="mt-2 animate-fade-in overflow-hidden">
              <ul className="divide-y divide-border">
                {closed.map((task) => (
                  <ClosedRow key={task.id} task={task} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      {(creating !== null || editing) && (
        <PersonalTaskDialog
          task={editing}
          initialTitle={creating ?? ''}
          onClose={() => { setCreating(null); setEditing(null); }}
        />
      )}
    </>
  );
}

/**
 * One line: type, Enter, done. It lands on today, like the dialog's default.
 * `compact` is the dashboard card's version — flatter, since it sits inside a
 * card rather than on the page.
 */
export function QuickAdd({
  today,
  onDetails,
  compact = false,
}: {
  today: string;
  onDetails: (title: string) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    const text = title.trim();
    if (!text) return;
    setError(null);
    startTransition(async () => {
      const res = await savePersonalTask({ id: null, title: text, notes: null, date: today, time: null, link: null });
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      setTitle('');
      router.refresh();
    });
  }

  return (
    <>
      <form
        onSubmit={(e) => { e.preventDefault(); add(); }}
        className={cn(
          'flex items-center gap-2 border transition-colors focus-within:border-accent/50',
          compact
            ? 'rounded-lg border-transparent bg-surface-2/70 py-0.5 pl-3 pr-1 focus-within:bg-surface'
            : 'rounded-xl border-border bg-surface py-1.5 pl-3.5 pr-1.5 shadow-card',
        )}
      >
        <Plus className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('ptask.quickPlaceholder')}
          aria-label={t('ptask.newTitle')}
          maxLength={200}
          disabled={pending}
          className={cn(
            'min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle',
            compact ? 'h-8 text-[13px]' : 'h-9 text-[14px]',
          )}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => { onDetails(title.trim()); setTitle(''); }}
          disabled={pending}
          title={t('ptask.details')}
          aria-label={t('ptask.details')}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          {!compact && <span className="hidden sm:inline">{t('ptask.details')}</span>}
        </Button>
        {title.trim() && (
          <Button type="submit" size="sm" variant="primary" loading={pending}>
            {t('ptask.quickAdd')}
          </Button>
        )}
      </form>
      {error && <div className="mt-2"><ErrorState message={error} /></div>}
    </>
  );
}

/** "Today · 15:00", "Tomorrow", "Sunday", "Tue 29 Sep" — whichever reads fastest. */
function useDueLabel() {
  const { t, locale } = useI18n();
  return (task: PersonalTask, today: string) => {
    if (!task.due_date) return null;
    const diff = daysFromToday(task.due_date, today);
    const date = DateTime.fromISO(task.due_date).setLocale(locale);
    const day =
      diff === 0 ? t('ptask.today')
      : diff === 1 ? t('ptask.tomorrow')
      : diff === -1 ? t('ptask.yesterday')
      : diff > 1 && diff < 7 ? capitalize(date.toFormat('cccc'))
      : capitalize(date.toFormat('ccc d LLL'));
    return task.due_time ? `${day} · ${task.due_time.slice(0, 5)}` : day;
  };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function TaskRow({
  task,
  group,
  today,
  onEdit,
  compact = false,
}: {
  task: PersonalTask;
  group: Group;
  today: string;
  onEdit: () => void;
  /** Dashboard card: tighter, and notes left for the full page. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const dueLabel = useDueLabel();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function complete() {
    if (done) return;
    setDone(true);
    setError(null);
    startTransition(async () => {
      const res = await setPersonalTaskStatus(task.id, 'completed');
      if (!res.ok) { setDone(false); setError(t(reminderErrorKey(res.error))); return; }
      // Let the tick be seen before the row moves to the completed list.
      await new Promise((r) => setTimeout(r, 450));
      router.refresh();
    });
  }

  const label = dueLabel(task, today);

  return (
    <li className={cn('group transition-opacity duration-300', done && 'opacity-60')}>
      <div className={cn('flex items-start gap-3 px-3.5', compact ? 'py-2' : 'py-3')}>
        <button
          onClick={complete}
          aria-label={t('ptask.complete')}
          className={cn(
            'mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200',
            done
              ? 'scale-110 border-done bg-done text-white'
              : group === 'overdue'
                ? 'border-late/50 text-transparent hover:border-done hover:bg-done/10 hover:text-done'
                : 'border-border text-transparent hover:border-done hover:bg-done/10 hover:text-done',
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <button onClick={onEdit} className="block w-full text-left">
            <p
              className={cn(
                'font-medium leading-snug transition-colors',
                compact ? 'text-[13.5px]' : 'text-[14px]',
                done && 'text-muted line-through',
              )}
            >
              {task.title}
            </p>
            {task.notes && !compact && (
              <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[12.5px] text-muted">{task.notes}</p>
            )}
          </button>

          {(label || task.source_reminder_id || currentLink(task)) && (
            <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', compact ? 'mt-1' : 'mt-1.5')}>
              {label && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium tabular',
                    group === 'overdue' ? 'bg-late/10 text-late'
                    : group === 'today' ? 'bg-accent/10 text-accent'
                    : 'bg-surface-2 text-muted',
                  )}
                >
                  <CalendarDays className="h-3 w-3" aria-hidden />
                  {label}
                </span>
              )}
              <LinkChip row={task} />
              {task.source_reminder_id && (
                <Link href={`/reminders/${task.source_reminder_id}`} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-accent hover:underline">
                  <Bell className="h-3 w-3" aria-hidden />
                  {t('ptask.fromReminder')}
                </Link>
              )}
            </div>
          )}
          {error && <div className="mt-2"><ErrorState message={error} /></div>}
        </div>

        <button
          onClick={onEdit}
          aria-label={t('ptask.edit')}
          className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-surface-2 hover:text-fg sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}

function ClosedRow({ task }: { task: PersonalTask }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const completed = task.status === 'completed';
  const when = completed ? task.completed_at : task.cancelled_at;

  function reopen() {
    setError(null);
    startTransition(async () => {
      const res = await setPersonalTaskStatus(task.id, 'open');
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      router.refresh();
    });
  }

  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      {completed
        ? <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-done" aria-hidden />
        : <XCircle className="h-[18px] w-[18px] shrink-0 text-skipped" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-muted line-through">{task.title}</p>
        <p className="text-[11.5px] text-subtle">
          {completed ? t('ptask.completed') : t('ptask.cancelled')}
          {when ? ` · ${formatDate(DateTime.fromISO(when).setZone(BUSINESS_TZ).toISODate()!, 'medium')}` : ''}
        </p>
        {error && <div className="mt-2"><ErrorState message={error} /></div>}
      </div>
      <Button size="sm" variant="ghost" onClick={reopen} loading={pending}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        {t('ptask.reopen')}
      </Button>
    </li>
  );
}

function currentLink(task: PersonalTask | null): { type: LinkType; id: string } | null {
  if (!task) return null;
  for (const type of LINK_TYPES) {
    const id = task[LINK_COLUMN[type] as keyof PersonalTask] as string | null;
    if (id) return { type, id };
  }
  return null;
}

export function PersonalTaskDialog({
  task,
  initialTitle,
  onClose,
}: {
  task: PersonalTask | null;
  initialTitle: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(task?.title ?? initialTitle);
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [date, setDate] = useState(task ? task.due_date ?? '' : DateTime.now().setZone(BUSINESS_TZ).toISODate()!);
  const [time, setTime] = useState(task?.due_time?.slice(0, 5) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!title.trim()) { setError(t('reminder.error.title_required')); return; }
    startTransition(async () => {
      const res = await savePersonalTask({
        id: task?.id ?? null,
        title: title.trim(),
        notes: notes.trim() || null,
        date: date || null,
        time: date && time ? time : null,
        // Editing never re-points a link; it keeps whatever the task came with.
        link: currentLink(task),
      });
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      onClose();
      router.refresh();
    });
  }

  // Cancelling lives here rather than on every row: it is the rare action.
  function cancelTask() {
    if (!task) return;
    setError(null);
    startTransition(async () => {
      const res = await setPersonalTaskStatus(task.id, 'cancelled');
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={task ? t('ptask.editTitle') : t('ptask.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('ptask.save')}</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <Field label={t('ptask.fieldTitle')} htmlFor="pt-title" required>
          <Input id="pt-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('ptask.fieldDate')} htmlFor="pt-date">
            <Input id="pt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('ptask.fieldTime')} htmlFor="pt-time">
            <Input id="pt-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
          </Field>
        </div>
        <Field label={t('ptask.fieldNotes')} htmlFor="pt-notes">
          <Textarea id="pt-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </Field>
        {task?.status === 'open' && (
          <button
            type="button"
            onClick={cancelTask}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-late hover:underline disabled:opacity-50"
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden />
            {t('ptask.cancel')}
          </button>
        )}
        {error && <ErrorState message={error} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
