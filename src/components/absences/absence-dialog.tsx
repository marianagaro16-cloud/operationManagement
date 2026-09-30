'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { localizedName } from '@/lib/localized-content';
import { requestAbsence, updateAbsence } from '@/server/absence-actions';
import type { AbsenceRow, AbsenceType } from '@/types/absences';
import { useAbsenceLabels } from './absence-parts';

type OneDay = 'full' | 'morning' | 'afternoon';

/** Ask for an absence, or change one's own while it waits for a decision. */
export function AbsenceDialog({
  absence,
  types,
  today,
  onClose,
}: {
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
  const [start, setStart] = useState(absence?.start_date ?? today);
  const [end, setEnd] = useState(absence?.end_date ?? today);
  const [afternoonStart, setAfternoonStart] = useState(absence?.first_day === 'afternoon');
  const [morningEnd, setMorningEnd] = useState(absence?.last_day === 'morning');
  const [note, setNote] = useState(absence?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const oneDay = start === end;
  // On a single day: all of it, the morning or the afternoon.
  const oneDayPart: OneDay = afternoonStart ? 'afternoon' : morningEnd ? 'morning' : 'full';
  const ready = !!typeId && !!start && !!end && end >= start;

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const input = {
        type_id: typeId,
        start_date: start,
        end_date: end,
        first_day: afternoonStart ? ('afternoon' as const) : ('full' as const),
        last_day: morningEnd && !(oneDay && afternoonStart) ? ('morning' as const) : ('full' as const),
        note,
      };
      const res = absence ? await updateAbsence(absence.id, input) : await requestAbsence(input);
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={absence ? t('absence.edit') : t('absence.request')}
      description={t('absence.requestHint')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>
            {absence ? t('common.save') : t('absence.send')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('absence.type')} required htmlFor="absence-type">
          <Select id="absence-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} autoFocus>
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
          <Field label={t('absence.whichPart')} htmlFor="absence-part">
            <Select
              id="absence-part"
              value={oneDayPart}
              onChange={(e) => {
                const v = e.target.value as OneDay;
                setAfternoonStart(v === 'afternoon');
                setMorningEnd(v === 'morning');
              }}
              className="w-auto"
            >
              <option value="full">{t('absence.allDay')}</option>
              <option value="morning">{t('absence.onlyMorning')}</option>
              <option value="afternoon">{t('absence.onlyAfternoon')}</option>
            </Select>
          </Field>
        ) : (
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={afternoonStart} onChange={(e) => setAfternoonStart(e.target.checked)} />
              {t('absence.firstAfternoon')}
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={morningEnd} onChange={(e) => setMorningEnd(e.target.checked)} />
              {t('absence.lastMorning')}
            </label>
          </div>
        )}
        <Field label={t('absence.note')} hint={t('absence.notePrivate')} htmlFor="absence-note">
          <NoteTextarea id="absence-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
