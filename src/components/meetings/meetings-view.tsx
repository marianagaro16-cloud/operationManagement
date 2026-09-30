'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MapPin, Plus, Repeat } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import type { Meeting } from '@/types/meetings';
import { MeetingDialog } from './meeting-dialog';
import { ResponseBadge, hm, useMeetingLabels } from './meeting-parts';

/** The viewer's meetings: those ahead (organised or invited to), and past ones. */
export function MeetingsView({
  tab,
  meetings,
  viewerId,
  canOrganize,
  people,
  today,
}: {
  tab: 'upcoming' | 'past';
  meetings: Meeting[];
  viewerId: string;
  canOrganize: boolean;
  people: { id: string; name: string }[];
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const labels = useMeetingLabels();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title={t('meeting.navLabel')}
        subtitle={t('meeting.subtitle')}
        action={
          canOrganize && (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('meeting.new')}
            </Button>
          )
        }
      />
      <nav className="-mt-2 mb-4 flex gap-1 border-b border-border">
        {(['upcoming', 'past'] as const).map((key) => (
          <Link
            key={key}
            href={`/meetings?tab=${key}`}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {key === 'upcoming' ? t('meeting.tabUpcoming') : t('meeting.tabPast')}
          </Link>
        ))}
      </nav>

      {meetings.length === 0 ? (
        <EmptyState title={tab === 'upcoming' ? t('meeting.noneUpcoming') : t('meeting.nonePast')} />
      ) : (
        <Card className="divide-y divide-border">
          {meetings.map((m) => {
            const mine = m.invitees.find((i) => i.profile_id === viewerId);
            const coming = m.invitees.filter((i) => i.response === 'yes').length;
            const place = labels.place(m);
            return (
              <Link key={m.id} href={`/meetings/${m.id}`} className={cn('flex items-start gap-3 px-3.5 py-2.5 hover:bg-surface-2', m.status === 'cancelled' && 'opacity-60')}>
                <span className="w-24 shrink-0 text-[12.5px] leading-tight">
                  <span className={cn('block font-semibold capitalize', m.meeting_date === today && 'text-accent')}>{formatDate(m.meeting_date, 'weekday')}</span>
                  <span className="tabular text-muted">{hm(m.start_time)}–{hm(m.end_time)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('text-[13.5px] font-medium', m.status === 'cancelled' && 'line-through')}>{m.title}</span>
                    {m.series_id && <Repeat className="h-3.5 w-3.5 text-muted" aria-label={t('meeting.repeats')} />}
                    {m.status === 'cancelled' && <Badge tone="skipped">{t('meeting.cancelled')}</Badge>}
                    {mine && m.status === 'scheduled' && <ResponseBadge response={mine.response} />}
                  </span>
                  <span className="block text-[12px] text-muted">
                    {m.organizer_id === viewerId ? t('meeting.youOrganize') : t('meeting.byName', { name: m.organizer_name })}
                    {' · '}
                    {t('meeting.attendingCount', { yes: coming, total: m.invitees.length })}
                  </span>
                  {place && (
                    <span className="flex items-center gap-1 truncate text-[12px] text-muted">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                      {place}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </Card>
      )}

      {creating && (
        <MeetingDialog meeting={null} series={null} scope={null} people={people} viewerId={viewerId} today={today} onClose={() => setCreating(false)} />
      )}
    </>
  );
}
