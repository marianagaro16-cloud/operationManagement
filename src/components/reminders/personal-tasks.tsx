'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CalendarDays, Check, ChevronDown, Pencil, Plus, SlidersHorizontal, XCircle } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { daysFromToday, isOpenPersonalTask, type PersonalTaskStatus } from '@/domain/reminders/schedule';
import { LINK_COLUMN, LINK_TYPES, type LinkType } from '@/domain/reminders/links';
import { savePersonalTask, setPersonalTaskStatus } from '@/server/reminder-actions';
import type { PersonalTask, PersonalTopic } from '@/types/reminders';
import { TopicChip, TopicPicker, usePersonalTopics } from './topic-bits';
import { noteToPlainLine } from '@/domain/notes';
import { LinkChip, reminderErrorKey } from './reminder-bits';

export type Group = 'overdue' | 'today' | 'upcoming' | 'undated';

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
  topics,
}: {
  /** Shows the task's topic beside its date (the date view). */
  topics?: PersonalTopic[];
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
  const [status, setStatus] = useState<PersonalTaskStatus>(task.status);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // A refresh that brings a new status wins over the local one.
  useEffect(() => setStatus(task.status), [task.status]);

  /** Pending <-> In progress from the chip; Completed goes through the tick. */
  function changeStatus(next: PersonalTaskStatus) {
    if (next === 'completed') { complete(); return; }
    const previous = status;
    setStatus(next);
    setError(null);
    startTransition(async () => {
      const res = await setPersonalTaskStatus(task.id, next);
      if (!res.ok) { setStatus(previous); setError(t(reminderErrorKey(res.error))); return; }
      router.refresh();
    });
  }

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
            'relative',
            done
              ? 'scale-110 border-done bg-done text-white'
              : status === 'in_progress'
                ? 'border-accent text-transparent hover:border-done hover:bg-done/10 hover:text-done'
                : group === 'overdue'
                  ? 'border-late/50 text-transparent hover:border-done hover:bg-done/10 hover:text-done'
                  : 'border-border text-transparent hover:border-done hover:bg-done/10 hover:text-done',
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
          {status === 'in_progress' && !done && (
            <span className="pointer-events-none absolute inset-[3px] rounded-full bg-accent transition-opacity [button:hover>&]:opacity-0" aria-hidden />
          )}
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
              <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{noteToPlainLine(task.notes)}</p>
            )}
          </button>

          {(label || task.source_reminder_id || currentLink(task) || (topics && task.topic_id)) && (
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
              {topics && <TopicChip task={task} topics={topics} />}
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

        <TaskStatusChip status={done ? 'completed' : status} onChange={changeStatus} disabled={done} />

        <button
          onClick={onEdit}
          aria-label={t('ptask.edit')}
          className="-ml-1 -mr-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-surface-2 hover:text-fg sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}

const STATUS_OPTIONS: { value: PersonalTaskStatus; label: MessageKey }[] = [
  { value: 'open', label: 'ptask.statusOpen' },
  { value: 'in_progress', label: 'ptask.statusInProgress' },
  { value: 'completed', label: 'ptask.completed' },
];

/**
 * The status as a chip that is also its own picker.
 *
 * A native select under a styled label: on a phone that opens the system's
 * own picker, which is bigger and more familiar than any menu drawn here.
 */
export function TaskStatusChip({
  status,
  onChange,
  disabled,
}: {
  status: PersonalTaskStatus;
  onChange: (next: PersonalTaskStatus) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <span className="relative mt-px inline-flex shrink-0 items-center">
      <select
        value={status}
        disabled={disabled}
        aria-label={t('ptask.statusLabel')}
        onChange={(e) => onChange(e.target.value as PersonalTaskStatus)}
        className={cn(
          'h-6 cursor-pointer appearance-none rounded-full border py-0 pl-2 pr-5 text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default',
          status === 'in_progress' ? 'border-accent/25 bg-accent/10 text-accent'
          : status === 'completed' ? 'border-done/25 bg-done/10 text-done'
          : 'border-border bg-surface-2 text-muted hover:text-fg',
        )}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{t(o.label)}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 h-3 w-3 opacity-70" aria-hidden />
    </span>
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
  initialDate,
  initialFiling,
  topics: knownTopics,
  onClose,
}: {
  /** A new one filed here — from a topic's section. */
  initialFiling?: { topicId: string | null; categoryId: string | null };
  /** The viewer's topics when the page has them; otherwise fetched on open. */
  topics?: PersonalTopic[];
  task: PersonalTask | null;
  initialTitle: string;
  /** A new one for this day — from the agenda. */
  initialDate?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(task?.title ?? initialTitle);
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [date, setDate] = useState(task ? task.due_date ?? '' : initialDate ?? DateTime.now().setZone(BUSINESS_TZ).toISODate()!);
  const [time, setTime] = useState(task?.due_time?.slice(0, 5) ?? '');
  const [status, setStatus] = useState<PersonalTaskStatus | null>(task && isOpenPersonalTask(task.status) ? task.status : null);
  const [topics, setTopics] = usePersonalTopics(knownTopics);
  const [filing, setFiling] = useState(
    task ? { topicId: task.topic_id, categoryId: task.category_id } : initialFiling ?? { topicId: null, categoryId: null },
  );
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
        // Only once the topics are known, so a slow load cannot clear a filing.
        filing: topics ? { topic_id: filing.topicId, category_id: filing.categoryId } : undefined,
      });
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      if (task && status && status !== task.status) {
        const moved = await setPersonalTaskStatus(task.id, status);
        if (!moved.ok) { setError(t(reminderErrorKey(moved.error))); return; }
      }
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
        {status && (
          <div className="flex items-center gap-2 text-[13px] font-medium">
            {t('ptask.statusLabel')}
            <TaskStatusChip status={status} onChange={setStatus} />
          </div>
        )}
        {topics && (
          <TopicPicker
            topics={topics}
            onTopicsChange={setTopics}
            topicId={filing.topicId}
            categoryId={filing.categoryId}
            onChange={setFiling}
          />
        )}
        <Field label={t('ptask.fieldNotes')} htmlFor="pt-notes">
          <NoteTextarea id="pt-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </Field>
        {task && isOpenPersonalTask(task.status) && (
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
