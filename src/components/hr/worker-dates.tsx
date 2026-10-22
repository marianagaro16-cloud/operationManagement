'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { allImportantDates, DATE_NOTICE_DAYS, type ImportantDate } from '@/domain/hr/important-dates';
import { deleteWorkerDate, saveWorkerDate } from '@/server/hr-actions';
import type { HrWorker, HrWorkerDate } from '@/types/hr';
import { useHrError } from './worker-dialog';

/** How far off a date is, as a short badge: soon is amber, today red, past grey — an evaluation not done, red. */
export function DateDistance({ d }: { d: Pick<ImportantDate, 'daysAway'> & Partial<Pick<ImportantDate, 'kind'>> }) {
  const { t } = useI18n();
  if (d.daysAway < 0 && d.kind === 'evaluation') return <Badge tone="late">{t('hr.dateLate')}</Badge>;
  if (d.daysAway < 0) return <Badge tone="neutral">{t('hr.datePassed')}</Badge>;
  if (d.daysAway === 0) return <Badge tone="late">{t('hr.dateToday')}</Badge>;
  return <Badge tone={d.daysAway <= DATE_NOTICE_DAYS ? 'warn' : 'neutral'}>{t('hr.dateInDays', { n: d.daysAway })}</Badge>;
}

/** What a date is: the two fixed ones by name, the others by the name HR gave them. */
export function useDateLabel() {
  const { t } = useI18n();
  return (d: Pick<ImportantDate, 'kind' | 'label'>) =>
    d.kind === 'trial_end' ? t('hr.trialEnd')
      : d.kind === 'contract_end' ? t('hr.contractEnd')
        : d.kind === 'training' ? t('hrTraining.expires', { name: d.label ?? '' })
          : d.kind === 'evaluation' ? t('hr.nextEvaluation')
            : d.label ?? '';
}

/**
 * A file's important dates: the end of the trial period and of the contract
 * (set when editing the file), the next evaluation, and any other date kept here.
 */
export function WorkerDates({ worker, dates, evaluationDue, today }: { worker: HrWorker; dates: HrWorkerDate[]; evaluationDue: string | null; today: string }) {
  const { t, formatDate } = useI18n();
  const label = useDateLabel();
  const [editing, setEditing] = useState<HrWorkerDate | 'new' | null>(null);
  // Someone who left is not evaluated again.
  const due = worker.is_active && evaluationDue ? [{ worker_id: worker.id, on_date: evaluationDue }] : [];
  const all = allImportantDates([worker], dates, today, [], due);

  return (
    <Card className="mb-4 p-3.5 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <CalendarClock className="h-4 w-4 text-muted" aria-hidden />
          {t('hr.datesTitle')}
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setEditing('new')}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('hr.dateAdd')}
        </Button>
      </div>
      {all.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t('hr.datesNone')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {all.map((d) => {
            const custom = d.kind === 'custom' ? dates.find((x) => x.id === d.refId) : undefined;
            return (
              <li key={`${d.kind}-${d.refId}`} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="w-24 shrink-0 tabular text-muted">{formatDate(d.date, 'medium')}</span>
                <span className="min-w-0 flex-1 break-words">
                  {label(d)}
                  {custom?.note && <span className="text-muted"> · {custom.note}</span>}
                </span>
                <DateDistance d={d} />
                {custom && (
                  <Button size="icon" variant="ghost" aria-label={t('hr.dateEdit')} onClick={() => setEditing(custom)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] text-subtle">{t('hr.datesNotice')}</p>
      {editing && (
        <DateDialog workerId={worker.id} date={editing === 'new' ? null : editing} today={today} onClose={() => setEditing(null)} />
      )}
    </Card>
  );
}

function DateDialog({ workerId, date, today, onClose }: { workerId: string; date: HrWorkerDate | null; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useHrError();
  const [form, setForm] = useState({ label: date?.label ?? '', on_date: date?.on_date ?? today, note: date?.note ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => ReturnType<typeof saveWorkerDate>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(errorText(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={date ? t('hr.dateEdit') : t('hr.dateAdd')}
      className="max-w-md"
      footer={
        <>
          {date && (
            <Button variant="ghost" className="mr-auto text-late" onClick={() => run(() => deleteWorkerDate(workerId, date.id))} disabled={pending}>
              {t('hr.dateDelete')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!form.label.trim() || !form.on_date}
            onClick={() => run(() => saveWorkerDate(workerId, form, date?.id))}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('hr.dateLabel')} required htmlFor="hr-date-label">
          <Input id="hr-date-label" value={form.label} placeholder={t('hr.dateLabelPlaceholder')} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        </Field>
        <Field label={t('hr.dateOn')} required htmlFor="hr-date-on">
          <Input id="hr-date-on" type="date" value={form.on_date} onChange={(e) => setForm((f) => ({ ...f, on_date: e.target.value }))} />
        </Field>
        <Field label={t('hr.dateNote')} htmlFor="hr-date-note">
          <NoteTextarea id="hr-date-note" rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  );
}
