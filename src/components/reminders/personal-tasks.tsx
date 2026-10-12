'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, XCircle } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { isOpenPersonalTask, type PersonalTaskStatus } from '@/domain/reminders/schedule';
import { LINK_COLUMN, LINK_TYPES, type LinkType } from '@/domain/reminders/links';
import { savePersonalTask, setPersonalTaskStatus } from '@/server/reminder-actions';
import type { PersonalTask, PersonalTopic } from '@/types/reminders';
import { TopicPicker, usePersonalTopics } from './topic-bits';
import { reminderErrorKey } from './reminder-bits';

export type Group = 'overdue' | 'today' | 'upcoming' | 'undated';

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
