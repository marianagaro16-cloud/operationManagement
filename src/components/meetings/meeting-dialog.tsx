'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { checkMeetingConflicts, createMeeting, updateMeeting, updateSeries, type MeetingConflict } from '@/server/meeting-actions';
import type { Meeting, MeetingPlace, MeetingSeries } from '@/types/meetings';
import { hm, useMeetingLabels, useMonthlyLabel } from './meeting-parts';
import { monthlyNthOf, weekdayOf } from '@/domain/meetings/series';

type Repeat = 'none' | '1' | '2' | 'month';

/**
 * A new meeting (once or repeating), one meeting changed on its own, or a
 * series changed from today on.
 */
export function MeetingDialog({
  meeting,
  series,
  scope,
  people,
  viewerId,
  today,
  onClose,
}: {
  meeting: Meeting | null;
  series: MeetingSeries | null;
  /** When changing: this one, or the series from today on. */
  scope: 'one' | 'series' | null;
  people: { id: string; name: string }[];
  viewerId: string;
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useMeetingLabels();
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [date, setDate] = useState(meeting?.meeting_date ?? today);
  const [start, setStart] = useState(meeting ? hm(meeting.start_time) : '09:00');
  const [end, setEnd] = useState(meeting ? hm(meeting.end_time) : '10:00');
  const [place, setPlace] = useState<MeetingPlace | ''>(meeting?.place ?? 'office');
  const [detail, setDetail] = useState(meeting?.place_detail ?? '');
  const [agenda, setAgenda] = useState(meeting?.agenda ?? '');
  const [invitees, setInvitees] = useState<string[]>(meeting?.invitees.map((i) => i.profile_id) ?? []);
  const [repeat, setRepeat] = useState<Repeat>(
    scope === 'series' && series ? (series.monthly_nth ? 'month' : (String(series.interval_weeks) as Repeat)) : 'none',
  );
  const monthlyLabel = useMonthlyLabel();
  const [until, setUntil] = useState(scope === 'series' ? series?.until ?? '' : '');
  const [error, setError] = useState<string | null>(null);
  /** Who is busy then — shown before saving; saving anyway is the organiser's call. */
  const [conflicts, setConflicts] = useState<MeetingConflict[] | null>(null);
  const [pending, startTransition] = useTransition();
  const organizerId = meeting?.organizer_id ?? viewerId;
  const others = people.filter((p) => p.id !== organizerId);
  const showRepeat = !meeting || scope === 'series';
  const ready = !!title.trim() && !!date && !!start && !!end && end > start && (!until || until >= date);

  function submit(force = false) {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      if (!force) {
        const check = await checkMeetingConflicts({
          date,
          start,
          end,
          people: [organizerId, ...invitees],
          // Changing one meeting: not against itself.
          excludeId: meeting && scope !== 'series' ? meeting.id : null,
        });
        if (check.ok && check.data.length) return setConflicts(check.data);
      }
      const input = {
        title,
        agenda,
        place: place || null,
        place_detail: detail,
        meeting_date: date,
        start_time: start,
        end_time: end,
        invitees,
        repeat:
          showRepeat && repeat !== 'none'
            ? { interval_weeks: (repeat === '2' ? 2 : 1) as 1 | 2, monthly: repeat === 'month', until: until || null }
            : null,
      };
      const res = !meeting
        ? await createMeeting(input)
        : scope === 'series' && meeting.series_id
          ? await updateSeries(meeting.series_id, input)
          : await updateMeeting(meeting.id, input);
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      if (!meeting && res.data && 'id' in res.data && res.data.id) router.push(`/meetings/${res.data.id}`);
      else router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={!meeting ? t('meeting.new') : scope === 'series' ? t('meeting.editSeries') : t('meeting.edit')}
      description={scope === 'series' ? t('meeting.editSeriesHint') : scope === 'one' && meeting?.series_id ? t('meeting.editOneHint') : undefined}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          {conflicts ? (
            <Button variant="primary" onClick={() => submit(true)} loading={pending}>{t('meeting.saveAnyway')}</Button>
          ) : (
            <Button variant="primary" onClick={() => submit()} loading={pending} disabled={!ready}>{meeting ? t('common.save') : t('meeting.invite')}</Button>
          )}
        </>
      }
    >
      <div className="space-y-3.5" onChangeCapture={() => conflicts && setConflicts(null)} onClickCapture={(e) => {
        // A person added or removed also takes back the warning: it is checked again on saving.
        if (conflicts && (e.target as HTMLElement).closest('[aria-pressed]')) setConflicts(null);
      }}>
        {error && <ErrorState message={error} />}
        {conflicts && (
          <div className="rounded-lg border border-warn/40 bg-warn/[0.06] p-2.5">
            <p className="mb-1 text-[12.5px] font-semibold text-warn">{t('meeting.conflictsTitle')}</p>
            <ul className="space-y-0.5 text-[12.5px] text-warn">
              {conflicts.map((c, i) => (
                <li key={i}>
                  ⚠ {c.kind === 'absence'
                    ? t('meeting.conflictAway', { name: c.name })
                    : c.kind === 'meeting'
                      ? t('meeting.conflictMeeting', { name: c.name, what: c.label ?? '', times: `${c.start}–${c.end}` })
                      : t('meeting.conflictActivity', { name: c.name, what: c.label ?? '', times: `${c.start}–${c.end}` })}
                </li>
              ))}
            </ul>
            {scope === 'series' || (!meeting && repeat !== 'none') ? <p className="mt-1 text-[11.5px] text-muted">{t('meeting.conflictsFirstOnly')}</p> : null}
          </div>
        )}
        <Field label={t('meeting.title')} required htmlFor="meeting-title">
          <Input id="meeting-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('meeting.day')} required htmlFor="meeting-date">
            <Input id="meeting-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('meeting.from')} required htmlFor="meeting-start">
            <Input
              id="meeting-start"
              type="time"
              value={start}
              onChange={(e) => {
                const v = e.target.value;
                // Keep the length when the start moves.
                if (v && start && end > start) {
                  const len = (Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)));
                  const m = Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)) + len;
                  if (m < 24 * 60) setEnd(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
                }
                setStart(v);
              }}
            />
          </Field>
          <Field label={t('meeting.until')} required htmlFor="meeting-end" error={start && end && end <= start ? t('meeting.errTimes') : undefined}>
            <Input id="meeting-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Field label={t('meeting.where')} htmlFor="meeting-place">
            <Select id="meeting-place" value={place} onChange={(e) => setPlace(e.target.value as MeetingPlace | '')}>
              <option value="">—</option>
              <option value="office">{t('meeting.placeOffice')}</option>
              <option value="online">{t('meeting.placeOnline')}</option>
              <option value="other">{t('meeting.placeOther')}</option>
            </Select>
          </Field>
          <Field label={place === 'online' ? t('meeting.link') : t('meeting.whereDetail')} htmlFor="meeting-detail">
            <Input id="meeting-detail" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={place === 'online' ? 'https://…' : ''} />
          </Field>
        </div>
        <Field label={t('meeting.agenda')} htmlFor="meeting-agenda">
          <NoteTextarea id="meeting-agenda" rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </Field>
        <Field label={t('meeting.invitees')} hint={t('meeting.inviteesHint')}>
          <div className="flex flex-wrap gap-1.5">
            {others.map((p) => {
              const on = invitees.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setInvitees(on ? invitees.filter((x) => x !== p.id) : [...invitees, p.id])}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[12.5px]',
                    on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg',
                  )}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </Field>
        {showRepeat && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('meeting.repeat')} htmlFor="meeting-repeat">
              <Select id="meeting-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} disabled={scope === 'series'}>
                {scope !== 'series' && <option value="none">{t('meeting.repeatNone')}</option>}
                <option value="1">{t('meeting.repeatWeekly')}</option>
                <option value="2">{t('meeting.repeatBiweekly')}</option>
                {/* Named from the chosen day: "every month, the first Monday". */}
                <option value="month">{date ? monthlyLabel(weekdayOf(date), monthlyNthOf(date)) : t('meeting.repeatMonthly')}</option>
              </Select>
            </Field>
            {repeat !== 'none' && (
              <Field label={t('meeting.repeatUntil')} hint={t('meeting.repeatUntilHint')} htmlFor="meeting-until">
                <Input id="meeting-until" type="date" min={date} value={until} onChange={(e) => setUntil(e.target.value)} />
              </Field>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
