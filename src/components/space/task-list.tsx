'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CalendarDays, Check, CheckCircle2, MoreHorizontal, Plus, RotateCcw, Tags, XCircle } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { ErrorState } from '@/components/ui/primitives';
import { daysFromToday, isOnDay, personalTaskPhase, type PersonalTaskStatus } from '@/domain/reminders/schedule';
import { LINK_COLUMN, LINK_TYPES, type LinkType } from '@/domain/reminders/links';
import { noteToPlainLine } from '@/domain/notes';
import { savePersonalTask, setPersonalTaskStatus } from '@/server/reminder-actions';
import type { PersonalTask, PersonalTopic } from '@/types/reminders';
import { PersonalTaskDialog, TaskStatusChip, type Group } from '@/components/reminders/personal-tasks';
import { TopicChip, TopicDot } from '@/components/reminders/topic-bits';
import { LinkChip, reminderErrorKey } from '@/components/reminders/reminder-bits';
import { AutoTextarea, Fold, SpaceTitle } from './bits';

const GROUPS: { key: Group; label: MessageKey }[] = [
  { key: 'overdue', label: 'ptask.groupOverdue' },
  { key: 'today', label: 'ptask.groupToday' },
  { key: 'upcoming', label: 'ptask.groupUpcoming' },
  { key: 'undated', label: 'ptask.groupUndated' },
];

const VIEW_KEY = 'ptask.view';
const FOLDED_KEY = 'ptask.foldedTopics';

type Filing = { topicId: string | null; categoryId: string | null };

/**
 * Personal tasks, as a plain list written in place.
 *
 * One line per task: a tick, the task, when it is due. The title is changed
 * by typing on it, the date by choosing another, and a new task is the line
 * at the end of a group. What a task rarely needs — notes, a time, its topic,
 * cancelling — is behind the three dots.
 *
 * Nobody's business but the owner's: read from its own table, so no
 * operational screen, statistic or report can include it.
 */
export function SpaceTasks({
  open,
  closed,
  nowIso,
  topics,
}: {
  open: PersonalTask[];
  closed: PersonalTask[];
  nowIso: string;
  /** The viewer's own topics and categories. */
  topics: PersonalTopic[];
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<PersonalTask | null>(null);
  // By date or by topic, and what is folded; both remembered per browser.
  const [view, setView] = useState<'date' | 'topic'>('date');
  const [folded, setFolded] = useState<string[]>([]);
  // The finished ones stay folded until asked for.
  const [showClosed, setShowClosed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'topic') setView('topic');
      const saved = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
      if (Array.isArray(saved)) setFolded(saved);
    } catch {}
  }, []);
  const chooseView = (next: 'date' | 'topic') => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };
  const toggle = (key: string) => {
    const next = folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key];
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
    } catch {}
  };
  const isOpen = (key: string) => !folded.includes(key);

  const today = DateTime.fromISO(nowIso).setZone(BUSINESS_TZ).toISODate()!;
  const phase = (task: PersonalTask) => personalTaskPhase(task.status, task.due_date, task.due_time, nowIso) as Group;

  const groups: Record<Group, PersonalTask[]> = { overdue: [], today: [], upcoming: [], undated: [] };
  for (const task of open) {
    const p = phase(task);
    if (p in groups) groups[p].push(task);
  }
  const dueNow = groups.overdue.length + groups.today.length;
  const doneToday = closed.filter((c) => c.status === 'completed' && isOnDay(c.completed_at, today)).length;

  const rows = (list: PersonalTask[], showTopic: boolean) =>
    list.map((task) => (
      <TaskLine key={task.id} task={task} group={phase(task)} today={today} topics={showTopic ? topics : undefined} onDetails={() => setEditing(task)} />
    ));

  const known = new Set(topics.map((tp) => tp.id));
  // Active topics in their order; an archived one only while it still holds tasks.
  const shownTopics = topics.filter((tp) => !tp.archived_at || open.some((task) => task.topic_id === tp.id));
  const loose = open.filter((task) => !task.topic_id || !known.has(task.topic_id));

  return (
    <>
      <SpaceTitle title={t('space.tasks')}>
        <p className="mt-1 text-[13px] text-muted">
          {dueNow === 0 ? t('ptask.heroAllDone') : t('ptask.heroLeft', { count: dueNow })}
          {doneToday > 0 && <> · {t('ptask.heroDone', { count: doneToday })}</>}
        </p>
      </SpaceTitle>

      <div className="mb-3 flex items-center gap-4 border-b border-border text-[13px]">
        {(['date', 'topic'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => chooseView(v)}
            className={cn('-mb-px border-b-2 px-0.5 pb-1.5 font-medium transition-colors', view === v ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            {v === 'date' ? t('ptopic.byDate') : t('ptopic.byTopic')}
          </button>
        ))}
        <Link href="/reminders/tasks/topics" className="mb-1.5 ml-auto inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
          <Tags className="h-3.5 w-3.5" aria-hidden />
          {t('ptopic.manage')}
        </Link>
      </div>

      {view === 'date' ? (
        <div className="space-y-3">
          {GROUPS.map(({ key, label }) =>
            // Today is always there: it is where a new task is written.
            groups[key].length === 0 && key !== 'today' ? null : (
              <Fold key={key} open={isOpen(key)} onToggle={() => toggle(key)} label={t(label)} count={groups[key].length} tone={key === 'overdue' ? 'late' : undefined}>
                <ul>{rows(groups[key], true)}</ul>
                {key === 'today' && <NewTask date={today} />}
                {key === 'undated' && <NewTask date={null} />}
              </Fold>
            ),
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {shownTopics.map((topic) => {
            const mine = open.filter((task) => task.topic_id === topic.id);
            const categories = topic.categories.filter((c) => !c.archived_at || mine.some((task) => task.category_id === c.id));
            const uncategorised = mine.filter((task) => !task.category_id || !categories.some((c) => c.id === task.category_id));
            return (
              <Fold
                key={topic.id}
                open={isOpen(topic.id)}
                onToggle={() => toggle(topic.id)}
                count={mine.length}
                label={<span className="inline-flex min-w-0 items-center gap-2"><TopicDot color={topic.color} /><span className="truncate text-fg">{topic.name}</span></span>}
              >
                <div className="pl-4">
                  {categories.map((c) => {
                    const key = `${topic.id}:${c.id}`;
                    const list = mine.filter((task) => task.category_id === c.id);
                    return (
                      <Fold key={c.id} open={isOpen(key)} onToggle={() => toggle(key)} label={c.name} count={list.length}>
                        <ul>{rows(list, false)}</ul>
                        <NewTask date={today} filing={{ topicId: topic.id, categoryId: c.id }} />
                      </Fold>
                    );
                  })}
                  <ul>{rows(uncategorised, false)}</ul>
                  <NewTask date={today} filing={{ topicId: topic.id, categoryId: null }} />
                </div>
              </Fold>
            );
          })}
          <Fold open={isOpen('none')} onToggle={() => toggle('none')} label={t('ptopic.none')} count={loose.length}>
            <ul>{rows(loose, false)}</ul>
            <NewTask date={today} />
          </Fold>
        </div>
      )}

      {closed.length > 0 && (
        <div className="mt-6">
          <Fold open={showClosed} onToggle={() => setShowClosed((v) => !v)} label={t('ptask.groupClosed')} count={closed.length}>
            <ul>
              {closed.map((task) => (
                <ClosedRow key={task.id} task={task} />
              ))}
            </ul>
          </Fold>
        </div>
      )}

      {editing && <PersonalTaskDialog task={editing} initialTitle="" topics={topics} onClose={() => setEditing(null)} />}
    </>
  );
}

function currentLink(task: PersonalTask): { type: LinkType; id: string } | null {
  for (const type of LINK_TYPES) {
    const id = task[LINK_COLUMN[type] as keyof PersonalTask] as string | null;
    if (id) return { type, id };
  }
  return null;
}

/** "Today · 15:00", "Tomorrow", "Sunday", "Tue 29 Sep" — whichever reads fastest. */
function useDueLabel() {
  const { t, locale } = useI18n();
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
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

/** What only shows on a wide screen when the row is pointed at; always there on a phone. */
const quiet = 'sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 sm:focus-visible:opacity-100';

export function TaskLine({
  task,
  group,
  today,
  topics,
  onDetails,
  compact = false,
}: {
  task: PersonalTask;
  group: Group;
  today: string;
  /** Shows the task's topic on the line (the date view). */
  topics?: PersonalTopic[];
  onDetails: () => void;
  /** In a card on Inicio: the status only when it is in progress; the rest is in the details. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const dueLabel = useDueLabel();
  const [title, setTitle] = useState(task.title);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<PersonalTaskStatus>(task.status);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // A refresh that brings a new title or status wins over the local one.
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setStatus(task.status), [task.status]);

  /** Change one thing about the task; everything else stays as it is. */
  function save(patch: { title?: string; date?: string | null }) {
    const date = patch.date !== undefined ? patch.date : task.due_date;
    setError(null);
    startTransition(async () => {
      const res = await savePersonalTask({
        id: task.id,
        title: patch.title ?? task.title,
        notes: task.notes,
        date,
        time: date ? task.due_time?.slice(0, 5) ?? null : null,
        link: currentLink(task),
      });
      if (!res.ok) { setTitle(task.title); setError(t(reminderErrorKey(res.error))); return; }
      router.refresh();
    });
  }

  function rename() {
    const next = title.trim();
    if (!next) return setTitle(task.title);
    if (next !== task.title) save({ title: next });
  }

  function changeStatus(next: PersonalTaskStatus) {
    if (next === 'completed') return complete();
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
      // Let the tick be seen before the row moves to the completed ones.
      await new Promise((r) => setTimeout(r, 450));
      router.refresh();
    });
  }

  const label = dueLabel(task, today);

  return (
    <li className={cn('group rounded-md px-1 transition-colors hover:bg-surface-2/50', done && 'opacity-60')}>
      <div className="flex items-start gap-2.5 py-1.5">
        <button
          onClick={complete}
          aria-label={t('ptask.complete')}
          className={cn(
            'relative mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-all duration-200',
            done
              ? 'border-done bg-done text-white'
              : status === 'in_progress'
                ? 'border-accent text-transparent hover:border-done hover:text-done'
                : group === 'overdue'
                  ? 'border-late/60 text-transparent hover:border-done hover:text-done'
                  : 'border-subtle text-transparent hover:border-done hover:text-done',
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
          {status === 'in_progress' && !done && (
            <span className="pointer-events-none absolute inset-[3px] rounded-[2px] bg-accent transition-opacity [button:hover>&]:opacity-0" aria-hidden />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <AutoTextarea
            singleLine
            value={title}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setTitle(task.title);
              }
            }}
            aria-label={t('ptask.fieldTitle')}
            maxLength={200}
            disabled={done}
            className={cn('text-[14.5px] leading-snug', done && 'text-muted line-through')}
          />
          {task.notes && <p className="mt-0.5 line-clamp-1 text-[12.5px] text-muted">{noteToPlainLine(task.notes)}</p>}
          {(topics && task.topic_id) || task.source_reminder_id || currentLink(task) ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {topics && <TopicChip task={task} topics={topics} />}
              <LinkChip row={task} />
              {task.source_reminder_id && (
                <Link href={`/reminders/${task.source_reminder_id}`} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-accent hover:underline">
                  <Bell className="h-3 w-3" aria-hidden />
                  {t('ptask.fromReminder')}
                </Link>
              )}
            </div>
          ) : null}
          {error && <div className="mt-1"><ErrorState message={error} /></div>}
        </div>

        <div className={cn(status !== 'in_progress' && (compact ? 'hidden' : 'hidden sm:block'), status !== 'in_progress' && quiet)}>
          <TaskStatusChip status={done ? 'completed' : status} onChange={changeStatus} disabled={done} />
        </div>

        {/* The date: the label is what is read, the day picker opens over it. */}
        <label
          className={cn(
            'relative mt-px inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] tabular transition-colors hover:bg-surface-2',
            !label ? cn('text-subtle', quiet) : group === 'overdue' ? 'text-late' : group === 'today' ? 'text-accent' : 'text-muted',
          )}
        >
          <CalendarDays className="h-3 w-3" aria-hidden />
          {label ?? <span className="sr-only">{t('ptask.fieldDate')}</span>}
          <input
            type="date"
            value={task.due_date ?? ''}
            aria-label={t('ptask.fieldDate')}
            disabled={done}
            onClick={(e) => {
              try { e.currentTarget.showPicker(); } catch {}
            }}
            onChange={(e) => save({ date: e.target.value || null })}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        <button
          onClick={onDetails}
          aria-label={t('ptask.details')}
          title={t('ptask.details')}
          className={cn('mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-fg', quiet)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}

/** The line a new task is written on: type, Enter, and the next one can follow. */
export function NewTask({ date, filing }: { date: string | null; filing?: Filing }) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    const text = title.trim();
    if (!text || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await savePersonalTask({
        id: null,
        title: text,
        notes: null,
        date,
        time: null,
        link: null,
        filing: filing ? { topic_id: filing.topicId, category_id: filing.categoryId } : undefined,
      });
      if (!res.ok) return setError(t(reminderErrorKey(res.error)));
      setTitle('');
      router.refresh();
      requestAnimationFrame(() => input.current?.focus());
    });
  }

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-subtle focus-within:text-fg hover:bg-surface-2/50">
        <Plus className="h-[18px] w-[18px] shrink-0 p-px" aria-hidden />
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={add}
          placeholder={t('space.newTask')}
          aria-label={t('space.newTask')}
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent text-[14.5px] text-fg outline-none placeholder:text-subtle focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </form>
      {error && <div className="mt-1"><ErrorState message={error} /></div>}
    </>
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
      if (!res.ok) return setError(t(reminderErrorKey(res.error)));
      router.refresh();
    });
  }

  return (
    <li className="group flex items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-surface-2/50">
      {completed
        ? <CheckCircle2 className="mt-px h-[18px] w-[18px] shrink-0 text-done" aria-hidden />
        : <XCircle className="mt-px h-[18px] w-[18px] shrink-0 text-skipped" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="break-words text-[14.5px] leading-snug text-muted line-through">{task.title}</p>
        {error && <div className="mt-1"><ErrorState message={error} /></div>}
      </div>
      <span className="mt-0.5 shrink-0 text-[12px] tabular text-subtle">
        {completed ? '' : `${t('ptask.cancelled')} · `}
        {when ? formatDate(DateTime.fromISO(when).setZone(BUSINESS_TZ).toISODate()!, 'short') : ''}
      </span>
      <button
        onClick={reopen}
        disabled={pending}
        aria-label={t('ptask.reopen')}
        title={t('ptask.reopen')}
        className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50', quiet)}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
      </button>
    </li>
  );
}
