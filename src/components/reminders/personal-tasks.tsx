'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, Check, Pencil, Plus, RotateCcw, XCircle } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, SectionHeading, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { personalTaskPhase } from '@/domain/reminders/schedule';
import { LINK_COLUMN, LINK_TYPES, type LinkType } from '@/domain/reminders/links';
import { savePersonalTask, setPersonalTaskStatus } from '@/server/reminder-actions';
import type { PersonalTask } from '@/types/reminders';
import { LinkChip, reminderErrorKey } from './reminder-bits';

/**
 * Personal Tasks.
 *
 * A to-do list that is nobody's business but the owner's. It lives beside
 * Reminders, not beside Tasks, so it can never be mistaken for operational
 * work — and it is read from its own table, so no operational screen,
 * statistic or report could include it even by accident.
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
  const [creating, setCreating] = useState(false);

  const groups = {
    overdue: [] as PersonalTask[],
    today: [] as PersonalTask[],
    upcoming: [] as PersonalTask[],
    undated: [] as PersonalTask[],
  };
  for (const task of open) {
    const phase = personalTaskPhase(task.status, task.due_date, task.due_time, nowIso);
    if (phase in groups) groups[phase as keyof typeof groups].push(task);
  }

  const GROUP_KEY: Record<keyof typeof groups, MessageKey> = {
    overdue: 'ptask.groupOverdue',
    today: 'ptask.groupToday',
    upcoming: 'ptask.groupUpcoming',
    undated: 'ptask.groupUndated',
  };

  return (
    <>
      <PageHeader
        title={t('ptask.title')}
        subtitle={t('ptask.subtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('ptask.new')}
          </Button>
        }
      />

      <Link href="/reminders" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('reminder.title')}
      </Link>

      {open.length === 0 ? (
        <EmptyState title={t('ptask.empty')} body={t('ptask.emptyBody')} />
      ) : (
        <div className="space-y-5">
          {(Object.keys(groups) as (keyof typeof groups)[]).map((key) =>
            groups[key].length === 0 ? null : (
              <section key={key}>
                <SectionHeading title={t(GROUP_KEY[key])} />
                <ul className="mt-2 space-y-2">
                  {groups[key].map((task) => (
                    <li key={task.id}>
                      <PersonalTaskCard task={task} tone={key} onEdit={() => setEditing(task)} />
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      )}

      {closed.length > 0 && (
        <section className="mt-8">
          <SectionHeading title={t('ptask.groupClosed')} />
          <ul className="mt-2 space-y-2">
            {closed.map((task) => (
              <li key={task.id}>
                <PersonalTaskCard task={task} tone="closed" onEdit={() => setEditing(task)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(creating || editing) && (
        <PersonalTaskDialog
          task={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );
}

function PersonalTaskCard({
  task,
  tone,
  onEdit,
}: {
  task: PersonalTask;
  tone: 'overdue' | 'today' | 'upcoming' | 'undated' | 'closed';
  onEdit: () => void;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const closed = task.status !== 'open';

  function set(status: PersonalTask['status']) {
    setError(null);
    startTransition(async () => {
      const res = await setPersonalTaskStatus(task.id, status);
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      router.refresh();
    });
  }

  return (
    <Card
      className={cn(
        'border-l-[3px] px-3.5 py-3',
        tone === 'overdue' ? 'border-l-late' : tone === 'today' ? 'border-l-accent' : 'border-l-transparent',
        closed && 'opacity-75',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className={cn('text-[14px] font-medium leading-snug', closed && 'text-muted line-through')}>{task.title}</p>
          {task.due_date && (
            <p className={cn('mt-0.5 text-[12.5px] tabular', tone === 'overdue' ? 'font-semibold text-late' : 'text-muted')}>
              {formatDate(task.due_date, 'medium')}
              {task.due_time ? ` · ${task.due_time.slice(0, 5)}` : ''}
            </p>
          )}
          {task.notes && <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-muted">{task.notes}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone="neutral">{t('ptask.badge')}</Badge>
          {task.status === 'completed' && <Badge tone="done">{t('ptask.completed')}</Badge>}
          {task.status === 'cancelled' && <Badge tone="skipped">{t('ptask.cancelled')}</Badge>}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <LinkChip row={task} />
        {task.source_reminder_id && (
          <Link href={`/reminders/${task.source_reminder_id}`} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-accent hover:underline">
            <Bell className="h-3 w-3" aria-hidden />
            {t('ptask.fromReminder')}
          </Link>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {closed ? (
          <Button size="sm" variant="ghost" onClick={() => set('open')} loading={pending}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t('ptask.reopen')}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="success" onClick={() => set('completed')} loading={pending}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              {t('ptask.complete')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit} disabled={pending}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('ptask.edit')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => set('cancelled')} disabled={pending} className="text-late">
              <XCircle className="h-3.5 w-3.5" aria-hidden />
              {t('ptask.cancel')}
            </Button>
          </>
        )}
      </div>
      {error && <div className="mt-2"><ErrorState message={error} /></div>}
    </Card>
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

function PersonalTaskDialog({ task, onClose }: { task: PersonalTask | null; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [date, setDate] = useState(task?.due_date ?? DateTime.now().setZone('Europe/Zurich').toISODate()!);
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
        {error && <ErrorState message={error} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
