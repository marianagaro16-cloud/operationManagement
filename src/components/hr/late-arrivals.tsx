'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { localizedName } from '@/lib/localized-content';
import { deleteLateArrival, saveLateArrival } from '@/server/hr-actions';
import type { HrLateArrival, HrLateReason } from '@/types/hr';

const hm = (time: string) => time.slice(0, 5);

/** "1 h 25 min", "40 min". */
export function useMinutes() {
  const { t } = useI18n();
  return (minutes: number) =>
    minutes >= 60
      ? t('hrLate.hoursMinutes', { h: Math.floor(minutes / 60), m: minutes % 60 })
      : t('hrLate.minutes', { m: minutes });
}

type Tally = { total: number; unexcused: number; minutes: number };

function tally(list: HrLateArrival[], from: string, to?: string): Tally {
  const within = list.filter((a) => a.arrival_date >= from && (!to || a.arrival_date <= to));
  return {
    total: within.length,
    unexcused: within.filter((a) => !a.excused).length,
    minutes: within.reduce((s, a) => s + a.minutes_late, 0),
  };
}

/** Since the last evaluation — shown on the Evaluations tab too. */
export function LateSinceEvaluation({ arrivals, since }: { arrivals: HrLateArrival[]; since: string | null }) {
  const { t, formatDate } = useI18n();
  const minutes = useMinutes();
  const n = tally(arrivals, since ?? '0000-01-01');
  if (n.total === 0) return null;
  return (
    <p className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-2/70 px-3 py-2 text-[12.5px]">
      <Clock className="h-3.5 w-3.5 text-muted" aria-hidden />
      {since ? t('hrLate.sinceEvaluation', { date: formatDate(since, 'medium') }) : t('hrLate.sinceStart')}
      <strong>{t('hrLate.count', { count: n.total })}</strong>
      <span className="text-muted">· {t('hrLate.unexcusedCount', { count: n.unexcused })} · {minutes(n.minutes)}</span>
    </p>
  );
}

export function LateTab({
  workerId,
  arrivals,
  reasons,
  viewerId,
  today,
  lastEvaluationOn,
}: {
  workerId: string;
  arrivals: HrLateArrival[];
  reasons: HrLateReason[];
  viewerId: string;
  today: string;
  lastEvaluationOn: string | null;
}) {
  const { t, formatDate, locale } = useI18n();
  const minutes = useMinutes();
  const router = useRouter();
  const [editing, setEditing] = useState<HrLateArrival | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const day = DateTime.fromISO(today);
  const tiles: { label: string; n: Tally }[] = [
    { label: t('hrLate.thisMonth'), n: tally(arrivals, day.startOf('month').toISODate()!) },
    { label: t('hrLate.last3Months'), n: tally(arrivals, day.minus({ months: 2 }).startOf('month').toISODate()!) },
    { label: t('hrLate.thisYear'), n: tally(arrivals, day.startOf('year').toISODate()!) },
    {
      label: lastEvaluationOn ? t('hrLate.sinceEvaluationShort') : t('hrLate.sinceStartShort'),
      n: tally(arrivals, lastEvaluationOn ?? '0000-01-01'),
    },
  ];

  // Whoever recorded it, within a day: the database holds the same rule.
  const editable = (a: HrLateArrival) =>
    a.created_by === viewerId && Date.now() - new Date(a.created_at).getTime() < 24 * 60 * 60 * 1000;

  function remove(a: HrLateArrival) {
    if (!window.confirm(t('hrLate.deleteConfirm'))) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteLateArrival(workerId, a.id);
      if (!res.ok) return setError(res.error === 'late_locked' ? t('hrLate.errLocked') : t('common.error'));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(({ label, n }) => (
          <Card key={label} className="p-3">
            <p className="text-[11.5px] text-muted">{label}</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular leading-tight">{n.total}</p>
            <p className="text-[11.5px] text-muted">
              {t('hrLate.unexcusedCount', { count: n.unexcused })}
              {n.minutes > 0 && ` · ${minutes(n.minutes)}`}
            </p>
          </Card>
        ))}
      </div>

      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('hrLate.record')}
        </Button>
      </div>

      {error && <ErrorState message={error} />}

      {arrivals.length === 0 ? (
        <EmptyState title={t('hrLate.none')} />
      ) : (
        <Card className="divide-y divide-border">
          {arrivals.map((a) => (
            <div key={a.id} className="flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
                  <span className="font-medium">{formatDate(a.arrival_date, 'weekday')}</span>
                  <span className="tabular text-muted">
                    {hm(a.expected_time)} → {hm(a.arrived_time)}
                  </span>
                  <span className={cn('font-semibold tabular', a.excused ? 'text-muted' : 'text-late')}>+{minutes(a.minutes_late)}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                  {a.reason && <Badge tone="neutral">{localizedName(a.reason, locale)}</Badge>}
                  {a.excused && <Badge tone="done">{t('hrLate.excused')}</Badge>}
                  <Badge tone={a.notified ? 'accent' : 'neutral'}>{a.notified ? t('hrLate.notified') : t('hrLate.notNotified')}</Badge>
                  {a.author_name && <span className="text-muted">· {a.author_name}</span>}
                </div>
                {a.note && <NoteText className="mt-1 text-[12.5px] text-muted" text={a.note} />}
              </div>
              {editable(a) && (
                <div className="flex shrink-0 gap-0.5">
                  <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(a)} disabled={pending}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={t('common.delete')} onClick={() => remove(a)} disabled={pending}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      <p className="text-[11.5px] text-subtle">{t('hrLate.editRule')}</p>

      {editing && (
        <LateDialog
          workerId={workerId}
          entry={editing === 'new' ? null : editing}
          reasons={reasons}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function LateDialog({
  workerId,
  entry,
  reasons,
  today,
  onClose,
}: {
  workerId: string;
  entry: HrLateArrival | null;
  reasons: HrLateReason[];
  today: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const minutes = useMinutes();
  const router = useRouter();
  const [date, setDate] = useState(entry?.arrival_date ?? today);
  const [expected, setExpected] = useState(entry ? hm(entry.expected_time) : '');
  const [arrived, setArrived] = useState(entry ? hm(entry.arrived_time) : '');
  const [reasonId, setReasonId] = useState(entry?.reason?.id ?? '');
  const [excused, setExcused] = useState(entry?.excused ?? false);
  const [notified, setNotified] = useState(entry?.notified ?? false);
  const [note, setNote] = useState(entry?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A reason since switched off still shows on the entry that carries it.
  const options = entry?.reason && !reasons.some((r) => r.id === entry.reason!.id) ? [...reasons, { ...entry.reason, slug: '', sort_order: 999, is_active: false }] : reasons;
  const late =
    expected && arrived && arrived > expected
      ? DateTime.fromISO(`2000-01-01T${arrived}`).diff(DateTime.fromISO(`2000-01-01T${expected}`), 'minutes').minutes
      : null;
  const ready = !!date && !!expected && !!arrived && late !== null;

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await saveLateArrival(
        workerId,
        { arrival_date: date, expected_time: expected, arrived_time: arrived, reason_id: reasonId || null, excused, notified, note },
        entry?.id,
      );
      if (!res.ok) {
        return setError(
          res.error === 'late_locked' ? t('hrLate.errLocked') : res.error === 'arrived_not_late' ? t('hrLate.errNotLate') : res.error === 'not_authorized' ? t('hr.errNotAuthorized') : t('common.error'),
        );
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? t('hrLate.edit') : t('hrLate.record')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t('hrLate.date')} required htmlFor="late-date">
          <Input id="late-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('hrLate.expected')} required htmlFor="late-expected">
            <Input id="late-expected" type="time" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label={t('hrLate.arrived')} required htmlFor="late-arrived">
            <Input id="late-arrived" type="time" value={arrived} onChange={(e) => setArrived(e.target.value)} />
          </Field>
        </div>
        {expected && arrived && (
          <p className={cn('text-[12.5px] font-medium', late === null ? 'text-late' : 'text-muted')}>
            {late === null ? t('hrLate.errNotLate') : t('hrLate.lateBy', { time: minutes(Math.round(late)) })}
          </p>
        )}
        <Field label={t('hrLate.reason')} htmlFor="late-reason">
          <Select id="late-reason" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
            <option value="">—</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>{localizedName(r, locale)}</option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Checkbox label={t('hrLate.excused')} checked={excused} onChange={(e) => setExcused(e.target.checked)} />
          <Checkbox label={t('hrLate.notifiedQuestion')} checked={notified} onChange={(e) => setNotified(e.target.checked)} />
        </div>
        <Field label={t('hrLate.note')} htmlFor="late-note">
          <NoteTextarea id="late-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
      </div>
    </Dialog>
  );
}
