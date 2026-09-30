'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Pencil, Plus, Trash2, UserCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { coverAllDays, removeCoverage, saveCoverage } from '@/server/coverage-actions';
import { gaps as gapsOf, type CoverageConflict, type Period } from '@/domain/absences/coverage';
import type { AbsenceCalendarEntry, AbsenceStatus, CoverageAssignment } from '@/types/absences';
import { AbsenceStatusBadge, useAbsenceLabels } from './absence-parts';

const hm = (t: string) => t.slice(0, 5);

export interface PlannerDay {
  date: string;
  /** The hours to cover that day. */
  window: Period;
}

/** Who covers an absent person, day by day; what is still uncovered, in red. */
export function CoveragePlanner({
  absence,
  status,
  days,
  coverage,
  people,
  canPlan,
  needsCover,
}: {
  absence: AbsenceCalendarEntry;
  status: AbsenceStatus;
  days: PlannerDay[];
  coverage: CoverageAssignment[];
  people: { id: string; name: string }[];
  canPlan: boolean;
  needsCover: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useAbsenceLabels();
  const [editing, setEditing] = useState<{ date: string; row: CoverageAssignment | null; suggest: Period } | null>(null);
  const [removing, setRemoving] = useState<CoverageAssignment | null>(null);
  const [allWith, setAllWith] = useState('');
  const [allConflicts, setAllConflicts] = useState<CoverageConflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const approved = status === 'approved';
  const plan = canPlan && approved;
  const conflictText = useConflictText();
  const allName = people.find((p) => p.id === allWith)?.name ?? '';

  const perDay = days.map((d) => {
    const list = coverage.filter((c) => c.cover_date === d.date);
    return { ...d, list, gaps: gapsOf(d.window, list.map((c) => ({ start: hm(c.start_time), end: hm(c.end_time) }))) };
  });
  const uncovered = perDay.filter((d) => d.gaps.length > 0).length;

  function coverAll(force: boolean) {
    if (!allWith) return;
    setError(null);
    startTransition(async () => {
      const res = await coverAllDays(absence.id, allWith, force);
      if (!res.ok) return setError(labels.error(res.error));
      if (!res.data.saved && res.data.conflicts.length) return setAllConflicts(res.data.conflicts);
      setAllConflicts(null);
      setAllWith('');
      router.refresh();
    });
  }

  return (
    <>
      <Link href="/absences?tab=calendar" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('absence.navLabel')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <h1 className="text-xl font-semibold leading-tight">{t('coverage.titleFor', { name: absence.person_name })}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="tabular">{labels.span(absence)}</span>
          {!approved && <AbsenceStatusBadge status={status} />}
          {needsCover && <Badge tone="accent">{t('coverage.needsCover')}</Badge>}
        </p>
        {approved && needsCover && (
          <p className={cn('mt-2 flex items-center gap-1.5 text-[12.5px] font-medium', uncovered ? 'text-late' : 'text-done')}>
            {uncovered ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <UserCheck className="h-3.5 w-3.5" aria-hidden />}
            {uncovered ? t('coverage.daysUncovered', { count: uncovered }) : t('coverage.allCovered')}
          </p>
        )}
        {!approved && <p className="mt-2 text-[12.5px] text-muted">{t('coverage.onlyApproved')}</p>}

        {plan && days.length > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <Field label={t('coverage.allWith')} htmlFor="coverage-all">
              <Select id="coverage-all" value={allWith} onChange={(e) => { setAllWith(e.target.value); setAllConflicts(null); }} className="w-auto">
                <option value="">—</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Button size="sm" variant="secondary" onClick={() => coverAll(false)} disabled={!allWith || pending} loading={pending && !editing}>
              {t('coverage.allApply')}
            </Button>
          </div>
        )}
        {allConflicts && (
          <div className="mt-2 rounded-lg border border-warn/40 bg-warn/[0.06] p-2.5">
            <ul className="space-y-0.5 text-[12.5px] text-warn">
              {allConflicts.map((c, i) => <li key={i}>⚠ {conflictText(allName, c)}</li>)}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => coverAll(true)} loading={pending}>{t('coverage.saveAnyway')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setAllConflicts(null)}>{t('common.cancel')}</Button>
            </div>
          </div>
        )}
        {error && <div className="mt-2"><ErrorState message={error} /></div>}
      </Card>

      {days.length === 0 ? (
        <p className="text-[13px] text-muted">{t('coverage.noWorkingDays')}</p>
      ) : (
        <div className="space-y-2">
          {perDay.map((d) => (
            <Card key={d.date} className="p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">
                  {formatDate(d.date, 'weekday')}
                  <span className="ml-2 text-[12px] font-normal tabular text-muted">{d.window.start}–{d.window.end}</span>
                </p>
                {plan && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ date: d.date, row: null, suggest: d.gaps[0] ?? d.window })}>
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {t('coverage.add')}
                  </Button>
                )}
              </div>
              {d.list.length > 0 && (
                <ul className="space-y-0.5">
                  {d.list.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-[13px]">
                      <span className="w-24 shrink-0 tabular text-muted">{hm(c.start_time)}–{hm(c.end_time)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {c.coverer_name}
                        {c.note && <span className="ml-1.5 font-normal text-muted">{c.note}</span>}
                      </span>
                      {plan && (
                        <>
                          <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing({ date: d.date, row: c, suggest: d.window })}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                          <Button size="icon" variant="ghost" aria-label={t('common.delete')} onClick={() => setRemoving(c)}>
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {needsCover && d.gaps.length > 0 && (
                <p className="mt-1 flex items-center gap-1 text-[12.5px] font-medium text-late">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t('coverage.uncovered', { times: d.gaps.map((g) => `${g.start}–${g.end}`).join(', ') })}
                </p>
              )}
              {!needsCover && d.list.length === 0 && <p className="text-[12.5px] text-muted">{t('coverage.nobody')}</p>}
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <CoverageDialog
          absenceId={absence.id}
          date={editing.date}
          dates={days.map((d) => d.date)}
          row={editing.row}
          suggest={editing.suggest}
          people={people}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const c = removing;
          if (!c) return;
          setError(null);
          startTransition(async () => {
            const res = await removeCoverage(c.id);
            setRemoving(null);
            if (!res.ok) return setError(labels.error(res.error));
            router.refresh();
          });
        }}
        title={t('coverage.remove')}
        message={removing ? `${removing.coverer_name} · ${formatDate(removing.cover_date, 'weekday')} ${hm(removing.start_time)}–${hm(removing.end_time)}` : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
    </>
  );
}

export function useConflictText() {
  const { t } = useI18n();
  return (name: string, c: CoverageConflict) =>
    c.kind === 'away'
      ? t('coverage.conflictAway', { name })
      : t('coverage.conflictBusy', { name, covering: c.covering, times: `${c.start}–${c.end}` });
}

function CoverageDialog({
  absenceId,
  date: initialDate,
  dates,
  row,
  suggest,
  people,
  onClose,
}: {
  absenceId: string;
  date: string;
  dates: string[];
  row: CoverageAssignment | null;
  suggest: Period;
  people: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useAbsenceLabels();
  const conflictText = useConflictText();
  const [covererId, setCovererId] = useState(row?.coverer_id ?? '');
  const [date, setDate] = useState(row?.cover_date ?? initialDate);
  const [start, setStart] = useState(row ? hm(row.start_time) : suggest.start);
  const [end, setEnd] = useState(row ? hm(row.end_time) : suggest.end);
  const [note, setNote] = useState(row?.note ?? '');
  const [conflicts, setConflicts] = useState<CoverageConflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = !!covererId && !!date && !!start && !!end && end > start;
  const name = people.find((p) => p.id === covererId)?.name ?? '';

  function submit(force: boolean) {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await saveCoverage(
        { absence_id: absenceId, coverer_id: covererId, cover_date: date, start_time: start, end_time: end, note },
        row?.id,
        force,
      );
      if (!res.ok) return setError(labels.error(res.error));
      if (!res.data.saved) return setConflicts(res.data.conflicts);
      onClose();
      router.refresh();
    });
  }

  // Anything changed takes back the warning: it is checked again on saving.
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setConflicts(null);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? t('coverage.edit') : t('coverage.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          {conflicts ? (
            <Button variant="primary" onClick={() => submit(true)} loading={pending}>{t('coverage.saveAnyway')}</Button>
          ) : (
            <Button variant="primary" onClick={() => submit(false)} loading={pending} disabled={!ready}>{t('common.save')}</Button>
          )}
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {conflicts && (
          <ul className="space-y-0.5 rounded-lg border border-warn/40 bg-warn/[0.06] p-2.5 text-[12.5px] font-medium text-warn">
            {conflicts.map((c, i) => <li key={i}>⚠ {conflictText(name, c)}</li>)}
          </ul>
        )}
        <Field label={t('coverage.who')} required htmlFor="coverage-who">
          <Select id="coverage-who" value={covererId} onChange={(e) => touch(setCovererId)(e.target.value)} autoFocus>
            <option value="">—</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label={t('coverage.day')} required htmlFor="coverage-day">
          <Select id="coverage-day" value={date} onChange={(e) => touch(setDate)(e.target.value)}>
            {dates.map((d) => <option key={d} value={d}>{formatDate(d, 'weekday')}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('coverage.from')} required htmlFor="coverage-from">
            <Input id="coverage-from" type="time" value={start} onChange={(e) => touch(setStart)(e.target.value)} />
          </Field>
          <Field label={t('coverage.until')} required htmlFor="coverage-until">
            <Input id="coverage-until" type="time" value={end} onChange={(e) => touch(setEnd)(e.target.value)} />
          </Field>
        </div>
        <Field label={t('coverage.note')} htmlFor="coverage-note">
          <Input id="coverage-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
