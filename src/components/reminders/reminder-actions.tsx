'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClockOff, Check, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input } from '@/components/ui/primitives';
import { SNOOZE_PRESETS, type SnoozePreset } from '@/domain/reminders/schedule';
import { completeReminder, snoozeReminder } from '@/server/reminder-actions';
import type { Reminder } from '@/types/reminders';
import { ReminderDialog, type ReminderContextLink } from './reminder-dialog';
import { reminderErrorKey } from './reminder-bits';

const PRESET_KEY = {
  '10m': 'reminder.snooze10m',
  '1h': 'reminder.snooze1h',
  '3h': 'reminder.snooze3h',
  tomorrow: 'reminder.snoozeTomorrow',
} as const;

export function SnoozeDialog({
  reminder,
  open,
  onClose,
}: {
  reminder: Pick<Reminder, 'id' | 'timezone'>;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [custom, setCustom] = useState(false);
  const later = DateTime.now().setZone(reminder.timezone).plus({ hours: 2 });
  const [date, setDate] = useState(later.toISODate()!);
  const [time, setTime] = useState(later.toFormat('HH:00'));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(choice: Parameters<typeof snoozeReminder>[1]) {
    setError(null);
    startTransition(async () => {
      const res = await snoozeReminder(reminder.id, choice);
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('reminder.snoozeTitle')}>
      <div className="grid grid-cols-2 gap-2">
        {SNOOZE_PRESETS.map((preset: SnoozePreset) => (
          <Button key={preset} size="lg" onClick={() => run({ preset })} disabled={pending}>
            {t(PRESET_KEY[preset])}
          </Button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setCustom((v) => !v)}
        className="mt-3 text-[12.5px] font-medium text-muted hover:text-fg"
      >
        {t('reminder.snoozeCustom')}
      </button>

      {custom && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label={t('reminder.fieldDate')} htmlFor="snz-date">
            <Input id="snz-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('reminder.fieldTime')} htmlFor="snz-time">
            <Input id="snz-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => run({ date, time, timezone: reminder.timezone })}
          >
            {t('reminder.snoozeApply')}
          </Button>
        </div>
      )}

      {error && <div className="mt-3"><ErrorState message={error} /></div>}
    </Dialog>
  );
}

/** Complete + Snooze, the two things done from a list without opening anything. */
export function QuickActions({ reminder, size = 'sm' }: { reminder: Reminder; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const router = useRouter();
  const [snoozing, setSnoozing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (reminder.status !== 'open') return null;

  function complete() {
    setError(null);
    startTransition(async () => {
      const res = await completeReminder(reminder.id);
      if (!res.ok) { setError(t(reminderErrorKey(res.error))); return; }
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size={size} variant="success" onClick={complete} loading={pending}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          {reminder.recurrence === 'none' ? t('reminder.complete') : t('reminder.completeOccurrence')}
        </Button>
        <Button size={size} variant="secondary" onClick={() => setSnoozing(true)} disabled={pending}>
          <AlarmClockOff className="h-3.5 w-3.5" aria-hidden />
          {t('reminder.snooze')}
        </Button>
      </div>
      {error && <div className="mt-2"><ErrorState message={error} /></div>}
      {snoozing && <SnoozeDialog reminder={reminder} open={snoozing} onClose={() => setSnoozing(false)} />}
    </>
  );
}

/**
 * "+ Reminder", anywhere.
 *
 * On an entity's screen it passes that entity as the link, so the reminder
 * points at the order or incident it is about without copying anything from
 * it. Renders nothing for somebody without the capability — the page decides
 * that and passes `viewerId` only when it holds.
 */
export function QuickReminderButton({
  viewerId,
  link,
  variant = 'secondary',
  size = 'sm',
  className,
  compact = false,
}: {
  viewerId: string | null;
  link?: ReminderContextLink;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  className?: string;
  /** Icon only on a phone, for rows where the words would crowd out the content. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!viewerId) return null;

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className={className}
        aria-label={compact ? t('reminder.new') : undefined}
        title={compact ? t('reminder.new') : undefined}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {compact ? <span className="hidden sm:inline">{t('reminder.new')}</span> : t('reminder.new')}
      </Button>
      {open && (
        <ReminderDialog
          open={open}
          onClose={() => setOpen(false)}
          onSaved={() => router.refresh()}
          viewerId={viewerId}
          link={link}
        />
      )}
    </>
  );
}
