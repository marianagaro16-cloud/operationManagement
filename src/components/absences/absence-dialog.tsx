'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { localizedName } from '@/lib/localized-content';
import { registerAbsence, updateAbsence } from '@/server/absence-actions';
import type { AbsenceRow, AbsenceType } from '@/types/absences';
import { useAbsenceLabels } from './absence-parts';

/** On a single day: all of it, a half, or some hours. */
type OneDay = 'full' | 'morning' | 'afternoon' | 'hours';
/** The first day of several: all of it, from noon, or from a time. */
type FirstDay = 'full' | 'afternoon' | 'time';
/** The last day of several: all of it, until noon, or until a time. */
type LastDay = 'full' | 'morning' | 'time';

const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** Ask for an absence, or change one's own while it waits for a decision. */
export function AbsenceDialog({
  absence,
  types,
  today,
  people = [],
  viewerId,
  onClose,
}: {
  /** Whom a new absence can be entered for. */
  people?: { id: string; name: string }[];
  viewerId?: string;
  absence: AbsenceRow | null;
  types: AbsenceType[];
  today: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const labels = useAbsenceLabels();
  const choices = types.filter((x) => x.is_active || x.id === absence?.type_id);
  const [typeId, setTypeId] = useState(absence?.type_id ?? choices[0]?.id ?? '');
  const [personId, setPersonId] = useState(absence?.profile_id ?? people.find((p) => p.id !== viewerId)?.id ?? viewerId ?? '');
  const [start, setStart] = useState(absence?.start_date ?? today);
  const [end, setEnd] = useState(absence?.end_date ?? today);
  const [first, setFirst] = useState<FirstDay>(absence?.start_time ? 'time' : absence?.first_day === 'afternoon' ? 'afternoon' : 'full');
  const [last, setLast] = useState<LastDay>(absence?.end_time ? 'time' : absence?.last_day === 'morning' ? 'morning' : 'full');
  const [one, setOne] = useState<OneDay>(
    absence?.start_time || absence?.end_time
      ? 'hours'
      : absence?.first_day === 'afternoon'
        ? 'afternoon'
        : absence?.last_day === 'morning'
          ? 'morning'
          : 'full',
  );
  const [fromTime, setFromTime] = useState(hm(absence?.start_time));
  const [untilTime, setUntilTime] = useState(hm(absence?.end_time));
  const [note, setNote] = useState(absence?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const oneDay = start === end;

  // What goes to the server, from whichever choices apply.
  const shape = oneDay
    ? {
        first_day: one === 'afternoon' ? ('afternoon' as const) : ('full' as const),
        last_day: one === 'morning' ? ('morning' as const) : ('full' as const),
        start_time: one === 'hours' ? fromTime || null : null,
        end_time: one === 'hours' ? untilTime || null : null,
      }
    : {
        first_day: first === 'afternoon' ? ('afternoon' as const) : ('full' as const),
        last_day: last === 'morning' ? ('morning' as const) : ('full' as const),
        start_time: first === 'time' ? fromTime || null : null,
        end_time: last === 'time' ? untilTime || null : null,
      };
  const timesOk = oneDay
    ? one !== 'hours' || (!!fromTime && !!untilTime && untilTime > fromTime)
    : (first !== 'time' || !!fromTime) && (last !== 'time' || !!untilTime);
  const ready = !!typeId && !!start && !!end && end >= start && timesOk && (!!absence || !!personId);

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const input = { type_id: typeId, start_date: start, end_date: end, ...shape, note };
      const res = absence ? await updateAbsence(absence.id, input) : await registerAbsence(personId, input);
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={absence ? t('absence.edit') : t('absence.register')}
      description={absence ? undefined : personId === viewerId ? t('absence.registerOwnHint') : t('absence.registerHint')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {absence ? (
          <p className="text-[13.5px] font-medium">{absence.person_name}</p>
        ) : (
          <Field label={t('absence.person')} required htmlFor="absence-person">
            <Select id="absence-person" value={personId} onChange={(e) => setPersonId(e.target.value)} autoFocus>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label={t('absence.type')} required htmlFor="absence-type">
          <Select id="absence-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {choices.map((x) => <option key={x.id} value={x.id}>{localizedName(x, locale)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('absence.from')} required htmlFor="absence-start">
            <Input
              id="absence-start"
              type="date"
              value={start}
              onChange={(e) => {
                const v = e.target.value;
                setStart(v);
                if (v && (!end || end < v)) setEnd(v);
              }}
            />
          </Field>
          <Field label={t('absence.until')} required htmlFor="absence-end">
            <Input id="absence-end" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        {oneDay ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('absence.whichPart')} htmlFor="absence-part">
              <Select id="absence-part" value={one} onChange={(e) => setOne(e.target.value as OneDay)} className="w-auto">
                <option value="full">{t('absence.allDay')}</option>
                <option value="morning">{t('absence.onlyMorning')}</option>
                <option value="afternoon">{t('absence.onlyAfternoon')}</option>
                <option value="hours">{t('absence.someHours')}</option>
              </Select>
            </Field>
            {one === 'hours' && (
              <>
                <Field label={t('absence.fromHour')} htmlFor="absence-from-time">
                  <Input id="absence-from-time" type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} className="w-auto" />
                </Field>
                <Field
                  label={t('absence.untilHour')}
                  htmlFor="absence-until-time"
                  error={fromTime && untilTime && untilTime <= fromTime ? t('absence.errTimes') : undefined}
                >
                  <Input id="absence-until-time" type="time" value={untilTime} onChange={(e) => setUntilTime(e.target.value)} className="w-auto" />
                </Field>
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Field label={t('absence.firstDay')} htmlFor="absence-first">
                <Select id="absence-first" value={first} onChange={(e) => setFirst(e.target.value as FirstDay)}>
                  <option value="full">{t('absence.allDay')}</option>
                  <option value="afternoon">{t('absence.fromNoon')}</option>
                  <option value="time">{t('absence.fromAnHour')}</option>
                </Select>
              </Field>
              {first === 'time' && (
                <Input type="time" aria-label={t('absence.fromHour')} value={fromTime} onChange={(e) => setFromTime(e.target.value)} className="w-auto" />
              )}
            </div>
            <div className="space-y-2">
              <Field label={t('absence.lastDay')} htmlFor="absence-last">
                <Select id="absence-last" value={last} onChange={(e) => setLast(e.target.value as LastDay)}>
                  <option value="full">{t('absence.allDay')}</option>
                  <option value="morning">{t('absence.untilNoon')}</option>
                  <option value="time">{t('absence.untilAnHour')}</option>
                </Select>
              </Field>
              {last === 'time' && (
                <Input type="time" aria-label={t('absence.untilHour')} value={untilTime} onChange={(e) => setUntilTime(e.target.value)} className="w-auto" />
              )}
            </div>
          </div>
        )}

        <Field label={t('absence.note')} hint={t('absence.notePrivate')} htmlFor="absence-note">
          <NoteTextarea id="absence-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
