'use client';

import { Check, HelpCircle, Plane, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/primitives';
import type { Meeting, MeetingResponse } from '@/types/meetings';

/* What the meeting screens share. */

export const hm = (t: string) => t.slice(0, 5);

export function useMeetingLabels() {
  const { t } = useI18n();
  return {
    place: (m: Pick<Meeting, 'place' | 'place_detail'>) => {
      const where =
        m.place === 'office' ? t('meeting.placeOffice') : m.place === 'online' ? t('meeting.placeOnline') : m.place === 'other' ? t('meeting.placeOther') : null;
      return [where, m.place_detail].filter(Boolean).join(' · ');
    },
    response: (r: MeetingResponse) => ({ pending: t('meeting.answerPending'), yes: t('meeting.answerYes'), no: t('meeting.answerNo') })[r],
    error: (code: string) => {
      switch (code) {
        case 'not_authorized': return t('meeting.errNotAuthorized');
        case 'meetings_times':
        case 'meeting_series_times': return t('meeting.errTimes');
        case 'meeting_series_until': return t('meeting.errUntil');
        case 'title_required': return t('meeting.errTitle');
        default: return code;
      }
    },
  };
}

/** An invitee's answer — or "away", when an approved absence covers the meeting. */
export function ResponseBadge({ response, away }: { response: MeetingResponse; away?: boolean }) {
  const { t } = useI18n();
  const labels = useMeetingLabels();
  if (away) {
    return (
      <Badge tone="skipped">
        <Plane className="h-3 w-3" aria-hidden />
        {t('meeting.away')}
      </Badge>
    );
  }
  const Icon = response === 'yes' ? Check : response === 'no' ? X : HelpCircle;
  return (
    <Badge tone={response === 'yes' ? 'done' : response === 'no' ? 'late' : 'neutral'}>
      <Icon className="h-3 w-3" aria-hidden />
      {labels.response(response)}
    </Badge>
  );
}
