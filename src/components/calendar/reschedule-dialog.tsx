'use client';

import { useState, useTransition } from 'react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input } from '@/components/ui/primitives';
import { rescheduleBlockedOccurrence } from '@/server/planning-actions';
import { BUSINESS_TZ } from '@/lib/datetime';

/**
 * A blocked activity, moved to another day.
 *
 * Only for blocked work: on the new day it is pending again, and the card
 * says where it came from and what was blocking it.
 */
export function RescheduleDialog({
  onClose,
  occurrenceId,
  title,
  day,
  today,
}: {
  onClose: () => void;
  occurrenceId: string;
  /** The activity, and whose copy it is. */
  title: string;
  /** The day it is on now. */
  day: string;
  today: string;
}) {
  const { t, formatDate } = useI18n();
  // The next day it could be done: today for late work, otherwise the day after.
  const [date, setDate] = useState(
    day < today ? today : (DateTime.fromISO(day, { zone: BUSINESS_TZ }).plus({ days: 1 }).toISODate() as string),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today && date !== day;

  function translate(code: string): string {
    switch (code) {
      case 'not_authorized': return t('plan.errNotAuthorized');
      case 'occurrence_not_found': return t('plan.errNotFound');
      case 'not_blocked': return t('plan.errNotBlocked');
      case 'same_day': return t('plan.errSameDay');
      case 'invalid_date':
      case 'date_in_past': return t('plan.errDateInPast');
      case 'already_planned': return t('plan.errAlreadyThatDay');
      default: return code;
    }
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await rescheduleBlockedOccurrence(occurrenceId, date);
      if (!res.ok) return setError(translate(res.error));
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('plan.rescheduleTitle')}
      description={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!valid}>
            {t('plan.reschedule')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <p className="text-[12.5px] text-muted">{t('plan.rescheduleBody')}</p>
        <Field
          label={t('plan.rescheduleDate')}
          required
          htmlFor="reschedule-date"
          hint={valid ? formatDate(date, 'weekday') : undefined}
          error={date && date < today ? t('plan.errDateInPast') : date === day ? t('plan.errSameDay') : undefined}
        >
          <Input
            id="reschedule-date"
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="tabular"
          />
        </Field>
        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}
