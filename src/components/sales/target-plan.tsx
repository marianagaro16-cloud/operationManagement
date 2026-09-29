'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarPlus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { addNote, planActivity } from '@/server/sales-actions';
import { KindBadge, useKinds } from './activity-kind';
import { PlanFields, emptyPlan, toPlanInput, type PlanDraft } from './plan-fields';
import type { ActivityKind, SalesActivity } from '@/types/sales';

/* What a customer's file and a prospect's page share: notes, and what is planned with them. */

export interface Target {
  kind: 'customer' | 'prospect';
  id: string;
}

const tomorrow = (today: string) => DateTime.fromISO(today, { zone: BUSINESS_TZ }).plus({ days: 1 }).toISODate()!;

/** What is still planned with them, soonest first; a prospect with nothing planned is flagged. */
export function PlannedList({
  planned,
  kinds,
  today,
  onPlan,
  requireOne = false,
}: {
  planned: SalesActivity[];
  kinds: ActivityKind[];
  today: string;
  onPlan: () => void;
  /** A prospect must always have something planned. */
  requireOne?: boolean;
}) {
  const { t, formatDate } = useI18n();
  const k = useKinds(kinds);
  return (
    <Card className="mb-4 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('sales.planned')}</p>
        <Button size="sm" variant="ghost" onClick={onPlan}>
          <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
          {t('sales.planShort')}
        </Button>
      </div>
      {planned.length === 0 ? (
        requireOne ? (
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-late">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t('sales.planNothing')}
          </p>
        ) : (
          <p className="text-[12.5px] text-muted">{t('sales.planNoneShort')}</p>
        )
      ) : (
        <ul className="space-y-1">
          {planned.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className={a.activity_date < today ? 'font-semibold tabular text-late' : 'tabular'}>
                {formatDate(a.activity_date, 'weekday')}
                {a.activity_time && ` · ${a.activity_time.slice(0, 5)}`}
              </span>
              <KindBadge kind={k.get(a.kind_id)} />
              {a.title && <span className="truncate text-muted">{a.title}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Plan an activity with this customer or prospect. */
export function PlanForTargetDialog({
  target,
  salespersonId,
  kinds,
  today,
  onClose,
}: {
  target: Target;
  /** A prospect's responsible salesperson; for a customer, whoever plans. */
  salespersonId: string;
  kinds: ActivityKind[];
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<PlanDraft>(emptyPlan(today, kinds));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const plan = toPlanInput(draft, kinds);

  function submit() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const res = await planActivity({
        ...plan,
        salesperson_id: salespersonId,
        customer_id: target.kind === 'customer' ? target.id : null,
        prospect_id: target.kind === 'prospect' ? target.id : null,
      });
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('sales.planAdd')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!plan}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <PlanFields draft={draft} onChange={setDraft} kinds={kinds} today={today} idPrefix="target-plan" />
      </div>
    </Dialog>
  );
}

/** A note on a customer or prospect — permanent — and optionally the next activity with them. */
export function NoteDialog({
  target,
  kinds,
  today,
  onClose,
}: {
  target: Target;
  kinds: ActivityKind[];
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const k = useKinds(kinds);
  const [kindId, setKindId] = useState(kinds.find((x) => x.is_active)?.id ?? '');
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [planNext, setPlanNext] = useState(false);
  const [next, setNext] = useState<PlanDraft>(emptyPlan(tomorrow(today), kinds));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextPlan = planNext ? toPlanInput(next, kinds) : null;
  const ready = !!body.trim() && !!kindId && (!planNext || !!nextPlan);

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await addNote({ target: target.kind, target_id: target.id, kind_id: kindId, note_date: date, body, next: nextPlan });
      if (!res.ok) return setError(res.error);
      router.refresh();
      if (res.data.next === 'failed') return setError(t('sales.planNextFailed'));
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('sales.newNote')}
      description={t('sales.notePermanent')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.noteKind')} htmlFor="note-kind">
            <Select id="note-kind" value={kindId} onChange={(e) => setKindId(e.target.value)}>
              {k.choices(kindId).map((kind) => <option key={kind.id} value={kind.id}>{k.name(kind.id)}</option>)}
            </Select>
          </Field>
          <Field label={t('sales.noteDate')} htmlFor="note-date">
            <Input id="note-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('sales.noteBody')} htmlFor="note-body" required>
          <NoteTextarea id="note-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
        </Field>
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={planNext} onChange={(e) => setPlanNext(e.target.checked)} />
          {t('sales.planNext')}
        </label>
        {planNext && (
          <div className="rounded-lg border border-accent/25 bg-accent/[0.04] p-3">
            <PlanFields draft={next} onChange={setNext} kinds={kinds} today={today} idPrefix="note-next" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
