'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ListTodo, Pencil, XCircle } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Card, ErrorState, SectionHeading } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { reminderPhase } from '@/domain/reminders/schedule';
import { cancelReminder, convertReminder } from '@/server/reminder-actions';
import type { Reminder, ReminderEvent, ReminderPerson } from '@/types/reminders';
import { ReminderDialog } from './reminder-dialog';
import { QuickActions } from './reminder-actions';
import {
  LinkChip,
  PhaseBadge,
  RECURRENCE_KEY,
  RecurrenceBadge,
  SharingLine,
  reminderErrorKey,
  useFormatMoment,
} from './reminder-bits';

export function ReminderDetail({
  reminder,
  events,
  people: mentioned,
  viewerId,
  nowIso,
}: {
  reminder: Reminder;
  events: ReminderEvent[];
  people: ReminderPerson[];
  viewerId: string;
  nowIso: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const format = useFormatMoment();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'convert' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const phase = reminderPhase(reminder.status, reminder.next_at, nowIso, reminder.timezone);
  const open = reminder.status === 'open';
  const isCreator = reminder.created_by === viewerId;

  // Names for history entries that refer to a person by id.
  const people = new Map<string, ReminderPerson>([
    ...mentioned.map((p) => [p.id, p] as const),
    ...reminder.participants.filter((p) => p.profile).map((p) => [p.user_id, p.profile!] as const),
  ]);

  function run(kind: 'cancel' | 'convert') {
    setError(null);
    startTransition(async () => {
      const res = kind === 'cancel' ? await cancelReminder(reminder.id) : await convertReminder(reminder.id);
      setConfirm(null);
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      router.refresh();
    });
  }

  function describe(e: ReminderEvent): string {
    const d = e.detail as Record<string, string | undefined>;
    const personName = (id?: string) => {
      const p = id ? people.get(id) : undefined;
      return p ? displayName(p) : t('reminder.someone');
    };
    switch (e.action) {
      case 'participant_added':
      case 'participant_removed':
        return t(`reminder.event.${e.action}`, { name: personName(d.user_id) });
      case 'snoozed':
        return t('reminder.event.snoozed', { time: d.until ? format(d.until, reminder.timezone) : '' });
      case 'occurrence_completed':
        return t('reminder.event.occurrence_completed', {
          time: d.next_due_at ? format(d.next_due_at, reminder.timezone) : '',
        });
      default:
        return t(`reminder.event.${e.action}` as MessageKey);
    }
  }

  return (
    <>
      <PageHeader
        title={reminder.title}
        action={
          <Link href="/reminders">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {t('reminder.back')}
            </Button>
          </Link>
        }
      />

      <Card className="mb-5 px-4 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <PhaseBadge phase={phase} />
          <RecurrenceBadge recurrence={reminder.recurrence} />
        </div>

        <p className={`mt-2 text-[15px] tabular ${phase === 'overdue' ? 'font-semibold text-late' : ''}`}>
          {format(reminder.next_at, reminder.timezone, 'long')}
        </p>
        {reminder.snoozed_until && open && (
          <p className="text-[12.5px] text-muted">
            {t('reminder.originallyDue', { time: format(reminder.due_at, reminder.timezone) })}
          </p>
        )}

        {reminder.notes && (
          <p className="mt-3 whitespace-pre-wrap text-[13.5px] text-fg">{reminder.notes}</p>
        )}

        <dl className="mt-3 space-y-1.5 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-muted">{reminder.is_shared ? t('reminder.sharedWith') : ''}</dt>
            <dd className="min-w-0"><SharingLine isShared={reminder.is_shared} participants={reminder.participants} viewerId={viewerId} /></dd>
          </div>
          {reminder.recurrence !== 'none' && (
            <div className="flex gap-2">
              <dt className="text-muted">{t('reminder.repeats')}</dt>
              <dd>{t(RECURRENCE_KEY[reminder.recurrence])}</dd>
            </div>
          )}
          {reminder.notify_before_minutes && (
            <div className="flex gap-2">
              <dt className="text-muted">{t('reminder.notify')}</dt>
              <dd>{t(`reminder.notifyBefore${reminder.notify_before_minutes}` as MessageKey)}</dd>
            </div>
          )}
          <div>
            <LinkChip row={reminder} />
          </div>
          {reminder.creator && reminder.is_shared && (
            <p className="text-subtle">
              {t('reminder.createdBy', { name: isCreator ? t('reminder.you') : displayName(reminder.creator) })}
            </p>
          )}
        </dl>

        {reminder.status === 'converted' && reminder.personal_task_id && (
          <Link
            href="/reminders/tasks"
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
          >
            <ListTodo className="h-4 w-4" aria-hidden />
            {t('reminder.openPersonalTask')}
          </Link>
        )}

        {open && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <QuickActions reminder={reminder} size="md" />

            {/* Editing, converting and cancelling change the reminder for
                everyone on it, so they are the creator's. */}
            {isCreator && (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  {t('reminder.edit')}
                </Button>
                {!reminder.is_shared && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirm('convert')}>
                    <ListTodo className="h-3.5 w-3.5" aria-hidden />
                    {t('reminder.convert')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setConfirm('cancel')} className="text-late">
                  <XCircle className="h-3.5 w-3.5" aria-hidden />
                  {t('reminder.cancel')}
                </Button>
              </div>
            )}
            {isCreator && reminder.is_shared && (
              <p className="text-[12px] text-subtle">{t('reminder.convertSharedHint')}</p>
            )}
          </div>
        )}

        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </Card>

      <SectionHeading title={t('reminder.history')} />
      <ol className="mt-2 space-y-2 border-l border-border pl-4">
        {events.map((e) => (
          <li key={e.id} className="relative text-[13px]">
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" aria-hidden />
            <p>
              <span className="font-medium">{e.actor ? displayName(e.actor) : t('reminder.someone')}</span>{' '}
              <span className="text-muted">{describe(e)}</span>
            </p>
            <p className="text-[11.5px] tabular text-subtle">{format(e.created_at, reminder.timezone, 'long')}</p>
          </li>
        ))}
      </ol>

      {editing && (
        <ReminderDialog
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={() => router.refresh()}
          viewerId={viewerId}
          reminder={reminder}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm)}
        title={confirm === 'convert' ? t('reminder.convertConfirmTitle') : t('reminder.cancelConfirmTitle')}
        message={
          confirm === 'convert'
            ? t('reminder.convertConfirmBody')
            : reminder.is_shared ? t('reminder.cancelSharedBody') : t('reminder.cancelConfirmBody')
        }
        confirmLabel={confirm === 'convert' ? t('reminder.convert') : t('reminder.cancel')}
        cancelLabel={t('reminder.keep')}
        destructive={confirm === 'cancel'}
        loading={pending}
      />
    </>
  );
}
