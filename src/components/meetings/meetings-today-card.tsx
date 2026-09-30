'use client';

import Link from 'next/link';
import { ExternalLink, Users } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/primitives';
import type { Meeting } from '@/types/meetings';
import { ResponseBadge, hm, useMeetingLabels } from './meeting-parts';

/** The viewer's meetings today. Nothing when there are none. */
export function MeetingsTodayCard({ meetings, viewerId }: { meetings: Meeting[]; viewerId: string }) {
  const { t } = useI18n();
  const labels = useMeetingLabels();
  if (meetings.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Users className="h-4 w-4 text-accent" aria-hidden />
          {t('meeting.today')}
        </h2>
        <Link href="/meetings" className="text-[12.5px] font-medium text-accent hover:underline">{t('meeting.navLabel')}</Link>
      </div>
      <Card className="divide-y divide-border">
        {meetings.map((m) => {
          const mine = m.invitees.find((i) => i.profile_id === viewerId);
          const link = m.place === 'online' && m.place_detail?.startsWith('http') ? m.place_detail : null;
          return (
            <div key={m.id} className="flex items-center gap-2.5 px-3.5 py-2">
              <span className="w-[4.75rem] shrink-0 text-[12px] font-semibold tabular text-muted">{hm(m.start_time)}–{hm(m.end_time)}</span>
              <Link href={`/meetings/${m.id}`} className="min-w-0 flex-1 hover:text-accent">
                <span className={cn('block truncate text-[13.5px]', mine?.response === 'no' && 'text-muted line-through')}>{m.title}</span>
                {!link && labels.place(m) && <span className="block truncate text-[12px] text-muted">{labels.place(m)}</span>}
              </Link>
              {link && (
                <a href={link} target="_blank" rel="noreferrer" aria-label={t('meeting.joinOnline')} className="shrink-0 text-accent">
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              )}
              {mine && <ResponseBadge response={mine.response} />}
            </div>
          );
        })}
      </Card>
    </section>
  );
}
