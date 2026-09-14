'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BellOff, Link2, Repeat, Users } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn, displayName } from '@/lib/utils';
import { Badge } from '@/components/ui/primitives';
import { resolveLink, type LinkedRecords } from '@/domain/reminders/links';
import type { Recurrence, ReminderPhase } from '@/domain/reminders/schedule';
import type { ReminderPerson } from '@/types/reminders';

/** A moment in the zone it was set in, in the viewer's language. */
export function useFormatMoment() {
  const { locale } = useI18n();
  return (iso: string, zone: string, style: 'time' | 'short' | 'long' = 'short') => {
    const dt = DateTime.fromISO(iso).setZone(zone).setLocale(locale);
    if (style === 'time') return dt.toFormat('HH:mm');
    if (style === 'long') return dt.toFormat('cccc d LLLL yyyy, HH:mm');
    return dt.toFormat('ccc d LLL, HH:mm');
  };
}

const PHASE: Record<ReminderPhase, { key: MessageKey; tone: 'late' | 'accent' | 'neutral' | 'done' | 'skipped' }> = {
  overdue:   { key: 'reminder.phaseOverdue',   tone: 'late' },
  today:     { key: 'reminder.phaseToday',     tone: 'accent' },
  upcoming:  { key: 'reminder.phaseUpcoming',  tone: 'neutral' },
  completed: { key: 'reminder.phaseCompleted', tone: 'done' },
  cancelled: { key: 'reminder.phaseCancelled', tone: 'skipped' },
  converted: { key: 'reminder.phaseConverted', tone: 'done' },
};

export function PhaseBadge({ phase }: { phase: ReminderPhase }) {
  const { t } = useI18n();
  return <Badge tone={PHASE[phase].tone}>{t(PHASE[phase].key)}</Badge>;
}

export const RECURRENCE_KEY: Record<Recurrence, MessageKey> = {
  none: 'reminder.repeatNone',
  daily: 'reminder.repeatDaily',
  weekdays: 'reminder.repeatWeekdays',
  weekly: 'reminder.repeatWeekly',
  monthly: 'reminder.repeatMonthly',
};

export function RecurrenceBadge({ recurrence }: { recurrence: Recurrence }) {
  const { t } = useI18n();
  if (recurrence === 'none') return null;
  return (
    <Badge tone="neutral">
      <Repeat className="h-2.5 w-2.5" aria-hidden />
      {t(RECURRENCE_KEY[recurrence])}
    </Badge>
  );
}

/**
 * Personal or shared, and with whom.
 *
 * Names only — never "assigned to" or "responsible". The order is the
 * participants' own, so the creator is not visually singled out as owner.
 */
export function SharingLine({
  isShared,
  participants,
  viewerId,
  compact = false,
}: {
  isShared: boolean;
  participants: { user_id: string; profile: ReminderPerson | null }[];
  viewerId: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (!isShared) return <Badge tone="neutral">{t('reminder.personal')}</Badge>;

  // The viewer's own name first, then everyone else's — names, not "you",
  // which reads badly in a list in Spanish and German.
  const names = [...participants]
    .sort((a, b) => Number(b.user_id === viewerId) - Number(a.user_id === viewerId))
    .map((p) => (p.profile ? displayName(p.profile) : t('reminder.someone')));

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
      <Badge tone="accent">
        <Users className="h-2.5 w-2.5" aria-hidden />
        {t('reminder.shared')}
      </Badge>
      {!compact && <span className="truncate">{names.join(', ')}</span>}
    </span>
  );
}

/** The linked record, opening its own screen. Nothing about it is stored here. */
export function LinkChip({ row, className }: { row: LinkedRecords; className?: string }) {
  const { t } = useI18n();
  const link = resolveLink(row);
  if (!link) return null;

  const type = t(`reminder.linkType.${link.type}` as MessageKey);
  if (!link.label) {
    // The record exists but this viewer cannot read it (RLS), or it was
    // removed. Say so rather than showing a dead link.
    return (
      <span className={cn('inline-flex items-center gap-1 text-[12px] text-subtle', className)}>
        <Link2 className="h-3 w-3" aria-hidden />
        {type} · {t('reminder.linkUnavailable')}
      </span>
    );
  }

  return (
    <Link
      href={link.href}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 text-[12px] text-muted transition-colors hover:text-accent hover:underline',
        className,
      )}
    >
      <Link2 className="h-3 w-3 shrink-0" aria-hidden />
      <span className="shrink-0">{type}</span>
      <span className="truncate font-medium text-fg">{link.label}</span>
    </Link>
  );
}

/**
 * Said once, where it matters: the reminders still work without push, and a
 * person who blocked notifications should know they will not be buzzed.
 */
export function PushBlockedNotice() {
  const { t } = useI18n();
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    setDenied(typeof Notification !== 'undefined' && Notification.permission === 'denied');
  }, []);
  if (!denied) return null;
  return (
    <p className="mb-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[12.5px] text-muted">
      <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
      {t('reminder.pushDenied')}
    </p>
  );
}

const ERROR_CODES = [
  'not_authorized', 'title_required', 'due_required', 'invalid_recurrence', 'invalid_link',
  'reminder_not_found', 'reminder_closed', 'participant_not_eligible', 'snooze_in_past',
  'snooze_too_far', 'invalid_next_occurrence', 'shared_cannot_convert', 'invalid_date', 'invalid_timezone',
];

export function reminderErrorKey(code: string): MessageKey {
  return (ERROR_CODES.includes(code) ? `reminder.error.${code}` : 'reminder.error.unknown') as MessageKey;
}
