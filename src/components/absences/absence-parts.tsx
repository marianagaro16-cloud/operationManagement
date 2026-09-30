'use client';

import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/primitives';
import { localizedName } from '@/lib/localized-content';
import type { AbsenceCalendarEntry, AbsenceStatus, AbsenceType } from '@/types/absences';

/* What the absence screens share: labels, the span of days, error texts. */

const STATUS_TONE = { pending: 'warn', approved: 'done', rejected: 'late', cancelled: 'skipped' } as const;

export function AbsenceStatusBadge({ status }: { status: AbsenceStatus }) {
  const labels = useAbsenceLabels();
  return <Badge tone={STATUS_TONE[status]}>{labels.status(status)}</Badge>;
}

export function useAbsenceLabels() {
  const { t, locale, formatDate } = useI18n();
  const day = (d: string) => formatDate(d, 'weekday');
  return {
    status: (s: AbsenceStatus) =>
      ({
        pending: t('absence.statusPending'),
        approved: t('absence.statusApproved'),
        rejected: t('absence.statusRejected'),
        cancelled: t('absence.statusCancelled'),
      })[s],
    type: (types: AbsenceType[], id: string) => {
      const found = types.find((x) => x.id === id);
      return found ? localizedName(found, locale) : '—';
    },
    /** "Mon 12.10 (afternoon) – Fri 16.10 (morning)", or one day, maybe only half of it. */
    span: (a: Pick<AbsenceCalendarEntry, 'start_date' | 'end_date' | 'first_day' | 'last_day'>) => {
      const first = a.first_day === 'afternoon' ? ` (${t('absence.afternoon')})` : '';
      const last = a.last_day === 'morning' ? ` (${t('absence.morning')})` : '';
      if (a.start_date === a.end_date) return `${day(a.start_date)}${first}${last}`;
      return `${day(a.start_date)}${first} – ${day(a.end_date)}${last}`;
    },
    /** On one given day: all day, the morning or the afternoon. */
    partOn: (a: Pick<AbsenceCalendarEntry, 'start_date' | 'end_date' | 'first_day' | 'last_day'>, d: string) => {
      if (d === a.start_date && a.first_day === 'afternoon') return t('absence.afternoon');
      if (d === a.end_date && a.last_day === 'morning') return t('absence.morning');
      return null;
    },
    error: (code: string) => {
      switch (code) {
        case 'not_authorized': return t('absence.errNotAuthorized');
        case 'absence_overlaps': return t('absence.errOverlaps');
        case 'absence_own': return t('absence.errOwn');
        case 'absence_not_pending': return t('absence.errNotPending');
        case 'absence_closed': return t('absence.errClosed');
        case 'absence_past': return t('absence.errPast');
        case 'absences_rejection_reason': return t('absence.errReason');
        case 'absences_dates': return t('absence.errDates');
        case 'absences_halves': return t('absence.errHalves');
        case 'approver_required': return t('absence.errApproverRequired');
        default: return code;
      }
    },
  };
}
