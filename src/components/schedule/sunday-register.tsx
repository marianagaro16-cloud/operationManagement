'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { nextSundayTurn } from '@/domain/schedule/schedule';
import { deleteSundayDuty, saveSundayDuty } from '@/server/schedule-actions';
import type { SchedulePerson, SundayDuty } from '@/types/schedule';
import { ScheduleTabs, useScheduleErrors } from './schedule-view';

const nextSunday = (after: string) => {
  const d = new Date(`${after}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};

/**
 * Sundays and holidays: who came, who is planned, and whose turn is next.
 * What a published week says replaces what was only planned; the rest is
 * written here by hand.
 */
export function SundayRegister({ duties, people, today, canEdit }: { duties: SundayDuty[]; people: SchedulePerson[]; today: string; canEdit: boolean }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const errorText = useScheduleErrors();
  const years = [...new Set([today.slice(0, 4), ...duties.map((d) => d.duty_date.slice(0, 4))])].sort().reverse();
  const [year, setYear] = useState(today.slice(0, 4));
  const [adding, setAdding] = useState<{ date: string; personId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rotation = people.filter((p) => p.is_active && p.in_sunday_rotation).sort((a, b) => a.sunday_order - b.sunday_order);
  // The first Sunday from today that nobody has yet, and whose turn that is.
  const taken = new Set(duties.map((d) => d.duty_date));
  let open = today;
  do open = nextSunday(open);
  while (taken.has(open));
  const turn = nextSundayTurn(rotation, duties);
  const turnName = rotation.find((p) => p.id === turn)?.name;

  const shown = duties.filter((d) => d.duty_date.startsWith(year));
  const byDate = [...new Set(shown.map((d) => d.duty_date))].sort().reverse();
  const last = (id: string) => duties.filter((d) => d.person_id === id).map((d) => d.duty_date).sort().pop();
  const count = (id: string) => shown.filter((d) => d.person_id === id).length;
  const originLabel = { planned: t('schedule.originPlanned'), schedule: t('schedule.originSchedule'), import: t('schedule.originImport') };

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteSundayDuty(id);
      if (!res.ok) return setError(errorText(res.error));
      router.refresh();
    });
  }

  return (
    <>
      <PageHeader
        title={t('schedule.title')}
        subtitle={t('schedule.subtitle')}
        action={
          canEdit ? (
            <Button variant="primary" size="sm" onClick={() => setAdding({ date: open, personId: turn ?? '' })}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('schedule.addDuty')}
            </Button>
          ) : undefined
        }
      />
      <ScheduleTabs current="sundays" canEdit={canEdit} />
      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_17rem]">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Select aria-label={t('schedule.year')} className="w-auto" value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          {byDate.length === 0 ? (
            <EmptyState title={t('schedule.noDuties')} />
          ) : (
            <Card className="divide-y divide-border">
              {byDate.map((date) => (
                <div key={date} className="flex items-start gap-3 px-3.5 py-2">
                  <p className="w-36 shrink-0 text-[13px] tabular text-muted">{formatDate(date, 'weekday')}</p>
                  <div className="min-w-0 flex-1 space-y-1">
                    {shown.filter((d) => d.duty_date === date).map((d) => (
                      <div key={d.id} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13.5px] font-medium">{d.person_name}</span>
                        <Badge tone={d.origin === 'schedule' ? 'done' : d.origin === 'planned' ? (date >= today ? 'accent' : 'neutral') : 'neutral'}>{originLabel[d.origin]}</Badge>
                        {d.note && <span className="text-[12px] text-muted">{d.note}</span>}
                        {canEdit && (
                          <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" aria-label={t('common.delete')} disabled={pending} onClick={() => remove(d.id)}>
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-3.5">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('schedule.nextTurn')}</p>
            {turnName ? (
              <>
                <p className="mt-1 text-[14px] font-semibold">{t('schedule.nextTurnBody', { name: turnName, date: formatDate(open, 'medium') })}</p>
                {canEdit && (
                  <Button className="mt-2" size="sm" variant="secondary" onClick={() => setAdding({ date: open, personId: turn ?? '' })}>
                    {t('schedule.assign')}
                  </Button>
                )}
              </>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted">{t('schedule.rotationEmpty')}</p>
            )}
          </Card>
          {rotation.length > 0 && (
            <Card className="p-3.5">
              <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('schedule.rotation')}</p>
              <ol className="space-y-1 text-[13px]">
                {rotation.map((p, i) => {
                  const lastDate = last(p.id);
                  return (
                    <li key={p.id} className="flex items-baseline gap-2">
                      <span className="w-4 tabular text-muted">{i + 1}</span>
                      <span className={p.id === turn ? 'font-semibold text-accent' : 'font-medium'}>{p.name}</span>
                      <span className="ml-auto text-right text-[11.5px] text-muted">
                        {t('schedule.times', { count: count(p.id), year })}
                        {lastDate && <> · {t('schedule.lastCame', { date: formatDate(lastDate, 'short') })}</>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}
        </div>
      </div>

      {adding && <DutyDialog initial={adding} people={people.filter((p) => p.is_active)} onClose={() => setAdding(null)} />}
    </>
  );
}

function DutyDialog({ initial, people, onClose }: { initial: { date: string; personId: string }; people: SchedulePerson[]; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useScheduleErrors();
  const [date, setDate] = useState(initial.date);
  const [personId, setPersonId] = useState(initial.personId || people[0]?.id || 'other');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const other = personId === 'other';
  const ready = !!date && (other ? !!name.trim() : !!personId);

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await saveSundayDuty({ duty_date: date, person_id: other ? null : personId, person_name: other ? name : undefined, note });
      if (!res.ok) return setError(errorText(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('schedule.addDuty')}
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('schedule.dutyDate')} required htmlFor="duty-date">
          <Input id="duty-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('schedule.dutyPerson')} required htmlFor="duty-person">
          <Select id="duty-person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="other">{t('schedule.otherPerson')}</option>
          </Select>
        </Field>
        {other && (
          <Field label={t('schedule.otherName')} required htmlFor="duty-name">
            <Input id="duty-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label={t('schedule.note')} htmlFor="duty-note">
          <Input id="duty-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
