'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ban, Check, ExternalLink, MapPin, Pencil, Repeat, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { answerMeeting, cancelMeeting, endSeries, saveMinutes } from '@/server/meeting-actions';
import type { Meeting, MeetingSeries } from '@/types/meetings';
import { MeetingDialog } from './meeting-dialog';
import { MeetingRecordCard } from './meeting-record';
import type { NotePerson } from '@/domain/hr/note-structure';
import type { MeetingRecord } from '@/types/meetings';
import { ResponseBadge, hm, useMeetingLabels, useMonthlyLabel } from './meeting-parts';

/** One meeting: when, where, what; who comes; one's answer; the minutes. */
export function MeetingView({
  meeting,
  series,
  viewerId,
  canChange,
  away,
  people,
  today,
  nowHm,
  summaries,
  record,
  attendable,
  canFile,
}: {
  /** Its record for the workers' files, draft or registered. */
  record: MeetingRecord | null;
  /** Whom its attendees are picked from: worker files and accounts. */
  attendable: NotePerson[];
  /** The viewer has access to workers' files. */
  canFile: boolean;
  /** Sales summaries attached to it. */
  summaries: { id: string; title: string }[];
  meeting: Meeting;
  series: MeetingSeries | null;
  viewerId: string;
  /** The organiser, or Admin. */
  canChange: boolean;
  /** Invitees away then (an approved absence covers the meeting). */
  away: string[];
  people: { id: string; name: string }[];
  today: string;
  nowHm: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useMeetingLabels();
  const monthlyLabel = useMonthlyLabel();
  const [editing, setEditing] = useState<'one' | 'series' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [ending, setEnding] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineNote, setDeclineNote] = useState('');
  const [minutes, setMinutes] = useState(meeting.minutes ?? '');
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mine = meeting.invitees.find((i) => i.profile_id === viewerId);
  const scheduled = meeting.status === 'scheduled';
  // Minutes once it has started.
  const started = meeting.meeting_date < today || (meeting.meeting_date === today && hm(meeting.start_time) <= nowHm);
  const place = labels.place(meeting);
  const link = meeting.place === 'online' && meeting.place_detail?.startsWith('http') ? meeting.place_detail : null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      after?.();
      if (!res.ok) return setError(labels.error(res.error ?? ''));
      router.refresh();
    });
  };

  return (
    <>
      <Link href="/meetings" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('meeting.navLabel')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold leading-tight">{meeting.title}</h1>
            <p className="mt-1 text-[13px] capitalize">
              {formatDate(meeting.meeting_date, 'weekday')} · <span className="tabular">{hm(meeting.start_time)}–{hm(meeting.end_time)}</span>
              {series && (
                <span className="ml-2 inline-flex items-center gap-1 normal-case text-muted">
                  <Repeat className="h-3.5 w-3.5" aria-hidden />
                  {series.monthly_nth
                    ? monthlyLabel(series.weekday, series.monthly_nth)
                    : series.interval_weeks === 1 ? t('meeting.repeatWeekly') : t('meeting.repeatBiweekly')}
                </span>
              )}
            </p>
            {place && (
              <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    {t('meeting.joinOnline')}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                ) : (
                  place
                )}
              </p>
            )}
            <p className="mt-0.5 text-[12.5px] text-muted">{t('meeting.byName', { name: meeting.organizer_name })}</p>
            {!scheduled && <Badge tone="skipped" className="mt-1">{t('meeting.cancelled')}</Badge>}
          </div>
          {canChange && scheduled && (
            <Button size="icon" variant="ghost" aria-label={t('meeting.edit')} onClick={() => setEditing('one')}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>

        {error && <div className="mt-3"><ErrorState message={error} /></div>}

        {mine && scheduled && meeting.meeting_date >= today && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-[12.5px] text-muted">{t('meeting.yourAnswer')}</span>
            <ResponseBadge response={mine.response} />
            <Button size="sm" variant={mine.response === 'yes' ? 'success' : 'secondary'} disabled={pending} onClick={() => run(() => answerMeeting(meeting.id, 'yes', ''))}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              {t('meeting.attend')}
            </Button>
            <Button size="sm" variant={mine.response === 'no' ? 'danger' : 'secondary'} disabled={pending} onClick={() => setDeclining(true)}>
              <X className="h-3.5 w-3.5" aria-hidden />
              {t('meeting.cannot')}
            </Button>
          </div>
        )}

        {canChange && scheduled && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
            {series && !series.ended_at && (
              <Button size="sm" variant="secondary" onClick={() => setEditing('series')}>
                <Repeat className="h-3.5 w-3.5" aria-hidden />
                {t('meeting.editSeries')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setCancelling(true)} disabled={pending}>
              <Ban className="h-3.5 w-3.5" aria-hidden />
              {t('meeting.cancelOne')}
            </Button>
            {series && !series.ended_at && (
              <Button size="sm" variant="ghost" onClick={() => setEnding(true)} disabled={pending}>
                {t('meeting.endSeries')}
              </Button>
            )}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {summaries.length > 0 && (
            <Card className="p-3">
              <h2 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('summary.attachedTitle')}</h2>
              <ul className="space-y-1">
                {summaries.map((s) => (
                  <li key={s.id}>
                    <Link href={`/summaries/${s.id}`} className="text-[13px] font-medium text-accent hover:underline">{s.title}</Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="p-3">
            <h2 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('meeting.agenda')}</h2>
            {meeting.agenda ? <NoteText text={meeting.agenda} className="text-[13px]" /> : <p className="text-[12.5px] text-muted">{t('meeting.noAgenda')}</p>}
          </Card>
          <Card className="p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('meeting.minutes')}</h2>
              {canChange && started && (
                <Button size="sm" variant="ghost" onClick={() => setMinutesOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  {meeting.minutes ? t('common.edit') : t('meeting.writeMinutes')}
                </Button>
              )}
            </div>
            {meeting.minutes ? (
              <NoteText text={meeting.minutes} className="text-[13px]" />
            ) : (
              <p className="text-[12.5px] text-muted">{started ? t('meeting.noMinutes') : t('meeting.minutesLater')}</p>
            )}
          </Card>
          <MeetingRecordCard meeting={meeting} record={record} people={attendable} today={today} started={started} canChange={canChange} canRegister={canFile} />
        </div>
        <Card className="p-3">
          <h2 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
            {t('meeting.invitees')} · {t('meeting.attendingCount', { yes: meeting.invitees.filter((i) => i.response === 'yes').length, total: meeting.invitees.length })}
          </h2>
          <ul className="divide-y divide-border">
            <li className="flex items-center gap-2 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 font-medium">{meeting.organizer_name}</span>
              <Badge tone="accent">{t('meeting.organizer')}</Badge>
            </li>
            {meeting.invitees.map((i) => (
              <li key={i.profile_id} className="py-1.5 text-[13px]">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">{i.name}</span>
                  <ResponseBadge response={i.response} away={away.includes(i.profile_id)} />
                </div>
                {i.note && <p className="text-[12px] text-muted">«{i.note}»</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {editing && (
        <MeetingDialog meeting={meeting} series={series} scope={editing} people={people} viewerId={viewerId} today={today} onClose={() => setEditing(null)} />
      )}
      {declining && (
        <Dialog
          open
          onClose={() => setDeclining(false)}
          title={t('meeting.cannot')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeclining(false)} disabled={pending}>{t('common.back')}</Button>
              <Button variant="danger" loading={pending} onClick={() => run(() => answerMeeting(meeting.id, 'no', declineNote), () => setDeclining(false))}>
                {t('meeting.cannot')}
              </Button>
            </>
          }
        >
          <Field label={t('meeting.declineNote')} htmlFor="meeting-decline-note">
            <Input id="meeting-decline-note" value={declineNote} onChange={(e) => setDeclineNote(e.target.value)} autoFocus />
          </Field>
        </Dialog>
      )}
      {minutesOpen && (
        <Dialog
          open
          onClose={() => setMinutesOpen(false)}
          title={t('meeting.minutes')}
          description={t('meeting.minutesHint')}
          className="max-w-xl"
          footer={
            <>
              <Button variant="ghost" onClick={() => setMinutesOpen(false)} disabled={pending}>{t('common.cancel')}</Button>
              <Button variant="primary" loading={pending} onClick={() => run(() => saveMinutes(meeting.id, minutes), () => setMinutesOpen(false))}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <NoteTextarea aria-label={t('meeting.minutes')} rows={10} value={minutes} onChange={(e) => setMinutes(e.target.value)} autoFocus />
        </Dialog>
      )}
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={() => run(() => cancelMeeting(meeting.id), () => setCancelling(false))}
        title={t('meeting.cancelOne')}
        message={t('meeting.cancelOneBody')}
        confirmLabel={t('meeting.cancelOne')}
        cancelLabel={t('common.back')}
        destructive
        loading={pending}
      />
      <ConfirmDialog
        open={ending}
        onClose={() => setEnding(false)}
        onConfirm={() => meeting.series_id && run(() => endSeries(meeting.series_id!), () => setEnding(false))}
        title={t('meeting.endSeries')}
        message={t('meeting.endSeriesBody')}
        confirmLabel={t('meeting.endSeries')}
        cancelLabel={t('common.back')}
        destructive
        loading={pending}
      />
    </>
  );
}
