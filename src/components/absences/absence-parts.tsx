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
  type Span = Pick<AbsenceCalendarEntry, 'start_date' | 'end_date' | 'first_day' | 'last_day'> &
    Partial<Pick<AbsenceCalendarEntry, 'start_time' | 'end_time'>>;
  const hm = (x: string) => x.slice(0, 5);
  const partOf = (a: Span, d: string): string | null => {
    const from = d === a.start_date ? (a.start_time ? hm(a.start_time) : null) : null;
    const to = d === a.end_date ? (a.end_time ? hm(a.end_time) : null) : null;
    if (from && to) return `${from}–${to}`;
    if (from) return t('absence.fromTime', { time: from });
    if (to) return t('absence.untilTime', { time: to });
    if (d === a.start_date && a.first_day === 'afternoon') return t('absence.afternoon');
    if (d === a.end_date && a.last_day === 'morning') return t('absence.morning');
    return null;
  };
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
    /** "Mon 12.10 (afternoon) – Fri 16.10 (until 10:00)", or one day, maybe only part of it. */
    span: (a: Span) => {
      if (a.start_date === a.end_date) {
        const part = partOf(a, a.start_date);
        return `${day(a.start_date)}${part ? ` (${part})` : ''}`;
      }
      const first = partOf(a, a.start_date);
      const last = partOf(a, a.end_date);
      return `${day(a.start_date)}${first ? ` (${first})` : ''} – ${day(a.end_date)}${last ? ` (${last})` : ''}`;
    },
    /** On one given day: null for the whole day, else the morning, the afternoon, or the hours. */
    partOn: (a: Span, d: string) => partOf(a, d),
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
        case 'absences_times': return t('absence.errTimes');
        case 'approver_required': return t('absence.errApproverRequired');
        default: return code;
      }
    },
  };
}
