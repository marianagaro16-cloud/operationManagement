'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn, displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { BUSINESS_TZ } from '@/lib/datetime';
import { NOTIFY_BEFORE, RECURRENCES, utcToLocal, type Recurrence } from '@/domain/reminders/schedule';
import type { LinkType } from '@/domain/reminders/links';
import { loadParticipantCandidates, saveReminder } from '@/server/reminder-actions';
import type { Reminder, ReminderPerson } from '@/types/reminders';
import { RECURRENCE_KEY, reminderErrorKey } from './reminder-bits';

export interface ReminderContextLink {
  type: LinkType;
  id: string;
  label: string;
}

/** The zone this device is in, which is what the person means by "10:00". */
function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || BUSINESS_TZ;
  } catch {
    return BUSINESS_TZ;
  }
}

/**
 * Create or edit a reminder.
 *
 * Built for the few seconds somebody has between two other things: the title
 * is focused, the date is already tomorrow at 09:00, and Save is one tap.
 * Everything else — notes, repeat, early warning, sharing — is behind More
 * options and optional.
 *
 * The link is set by WHERE the reminder was created (an order, an incident)
 * and can only be removed here, never re-pointed: choosing an arbitrary
 * entity from a form is a slower way to do what the "+ Reminder" button on
 * that entity already does.
 */
export function ReminderDialog({
  open,
  onClose,
  onSaved,
  viewerId,
  reminder,
  link,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
  viewerId: string;
  /** Present when editing. */
  reminder?: Reminder | null;
  /** Present when created from an entity's screen. */
  link?: ReminderContextLink | null;
}) {
  const { t } = useI18n();
  const zone = reminder?.timezone ?? deviceZone();
  const titleRef = useRef<HTMLInputElement>(null);

  const initial = () => {
    if (reminder) {
      const local = utcToLocal(reminder.due_at, reminder.timezone);
      return { date: local.date, time: local.time };
    }
    const tomorrow = DateTime.now().setZone(zone).plus({ days: 1 });
    return { date: tomorrow.toISODate()!, time: '09:00' };
  };

  const [title, setTitle] = useState(reminder?.title ?? '');
  const [date, setDate] = useState(initial().date);
  const [time, setTime] = useState(initial().time);
  const [notes, setNotes] = useState(reminder?.notes ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence>(reminder?.recurrence ?? 'none');
  const [notifyBefore, setNotifyBefore] = useState<number | null>(reminder?.notify_before_minutes ?? null);
  const [keepLink, setKeepLink] = useState(true);
  const [participants, setParticipants] = useState<string[]>(
    reminder ? reminder.participants.map((p) => p.user_id).filter((id) => id !== viewerId) : [],
  );
  const [more, setMore] = useState(Boolean(
    reminder && (reminder.notes || reminder.recurrence !== 'none' || reminder.notify_before_minutes || reminder.is_shared),
  ));
  const [candidates, setCandidates] = useState<ReminderPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) requestAnimationFrame(() => titleRef.current?.focus());
  }, [open]);

  // People are loaded only once somebody opens the options — most reminders
  // are personal, and the list is not needed to write one.
  useEffect(() => {
    if (!open || !more || candidates) return;
    loadParticipantCandidates().then((res) => {
      setCandidates(res.ok ? res.data.filter((p) => p.id !== viewerId) : []);
    });
  }, [open, more, candidates, viewerId]);

  const existingLink = reminder
    ? (['customer', 'order', 'incident', 'goods_reception', 'task', 'inventory', 'product'] as const)
        .map((type) => {
          const col = ({
            customer: 'customer_id', order: 'order_id', incident: 'incident_id',
            goods_reception: 'goods_reception_id', task: 'task_id',
            inventory: 'inventory_instance_id', product: 'product_id',
          } as const)[type];
          const id = reminder[col];
          return id ? { type, id } : null;
        })
        .find(Boolean) ?? null
    : null;
  const effectiveLink = keepLink ? (link ? { type: link.type, id: link.id } : existingLink) : null;

  function quick(kind: 'in1h' | 'tomorrow' | 'monday') {
    const now = DateTime.now().setZone(zone);
    const target =
      kind === 'in1h' ? now.plus({ hours: 1 }).set({ second: 0, millisecond: 0 })
        : kind === 'tomorrow' ? now.plus({ days: 1 }).set({ hour: 9, minute: 0 })
          : now.plus({ weeks: 1 }).startOf('week').set({ hour: 9, minute: 0 });
    setDate(target.toISODate()!);
    setTime(target.toFormat('HH:mm'));
  }

  function submit() {
    setError(null);
    if (!title.trim()) { setError(t('reminder.error.title_required')); return; }
    if (!date || !time) { setError(t('reminder.error.due_required')); return; }

    startTransition(async () => {
      const res = await saveReminder({
        id: reminder?.id ?? null,
        title: title.trim(),
        notes: notes.trim() || null,
        date,
        time,
        timezone: zone,
        recurrence,
        notifyBefore,
        link: effectiveLink,
        participantIds: participants,
      });
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      onSaved?.(res.data.id);
      onClose();
      if (!reminder) {
        setTitle(''); setNotes(''); setRecurrence('none'); setNotifyBefore(null); setParticipants([]);
      }
    });
  }

  const notifyKey = (m: number) => `reminder.notifyBefore${m}` as MessageKey;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={reminder ? t('reminder.editTitle') : t('reminder.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('reminder.save')}</Button>
        </>
      }
    >
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="space-y-3"
      >
        <Field label={t('reminder.fieldTitle')} htmlFor="rem-title" required>
          <Input
            id="rem-title"
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('reminder.titlePlaceholder')}
            maxLength={200}
            enterKeyHint="done"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t('reminder.fieldDate')} htmlFor="rem-date" required>
            <Input id="rem-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('reminder.fieldTime')} htmlFor="rem-time" required>
            <Input id="rem-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>

        {/* Large, one-tap targets for the times people actually pick. */}
        <div className="flex flex-wrap gap-1.5">
          {(['in1h', 'tomorrow', 'monday'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => quick(k)}
              className="touch-target rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-fg"
            >
              {t(k === 'in1h' ? 'reminder.quickIn1h' : k === 'tomorrow' ? 'reminder.quickTomorrow' : 'reminder.quickMonday')}
            </button>
          ))}
        </div>

        {(link || existingLink) && keepLink && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-[12.5px]">
            <span className="min-w-0 truncate text-muted">
              {t('reminder.linkedTo')}{' '}
              <span className="font-medium text-fg">
                {t(`reminder.linkType.${(link ?? existingLink)!.type}` as MessageKey)}
                {link ? ` · ${link.label}` : ''}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setKeepLink(false)}
              aria-label={t('reminder.removeLink')}
              className="shrink-0 text-subtle hover:text-late"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          className="flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg"
          aria-expanded={more}
        >
          {more ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
          {more ? t('reminder.fewerOptions') : t('reminder.moreOptions')}
        </button>

        {more && (
          <div className="space-y-3 border-t border-border pt-3">
            <Field label={t('reminder.fieldNotes')} htmlFor="rem-notes">
              <NoteTextarea id="rem-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
            </Field>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label={t('reminder.fieldRepeat')} htmlFor="rem-repeat" hint={t('reminder.repeatHint')}>
                <Select id="rem-repeat" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
                  {RECURRENCES.map((r) => <option key={r} value={r}>{t(RECURRENCE_KEY[r])}</option>)}
                </Select>
              </Field>
              <Field label={t('reminder.fieldNotify')} htmlFor="rem-notify">
                <Select
                  id="rem-notify"
                  value={notifyBefore ?? ''}
                  onChange={(e) => setNotifyBefore(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{t('reminder.notifyAtTime')}</option>
                  {NOTIFY_BEFORE.map((m) => <option key={m} value={m}>{t(notifyKey(m))}</option>)}
                </Select>
              </Field>
            </div>

            <fieldset>
              <legend className="mb-1 text-[12.5px] font-medium">{t('reminder.fieldShare')}</legend>
              <p className="mb-2 text-[12px] text-muted">{t('reminder.shareHint')}</p>
              {candidates === null ? (
                <p className="text-[12.5px] text-subtle">{t('reminder.loadingPeople')}</p>
              ) : candidates.length === 0 ? (
                <p className="text-[12.5px] text-subtle">{t('reminder.noPeople')}</p>
              ) : (
                <ul className={cn('space-y-1.5', candidates.length > 6 && 'max-h-48 overflow-y-auto pr-1')}>
                  {candidates.map((p) => (
                    <li key={p.id}>
                      <Checkbox
                        label={displayName(p)}
                        checked={participants.includes(p.id)}
                        onChange={(e) =>
                          setParticipants((cur) =>
                            e.target.checked ? [...cur, p.id] : cur.filter((id) => id !== p.id),
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          </div>
        )}

        {error && <ErrorState message={error} />}
        {/* Enter in the title submits. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
