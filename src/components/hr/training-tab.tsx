'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { localizedName } from '@/lib/localized-content';
import { defaultExpiry, latestTrainings, requiredTrainings, type TrainingStatus } from '@/domain/hr/trainings';
import { deleteTraining, saveTraining } from '@/server/hr-actions';
import type { HrTraining, HrTrainingKind, HrWorker } from '@/types/hr';
import { useHrError } from './worker-dialog';

const TONE: Record<TrainingStatus, 'done' | 'warn' | 'late'> = { ok: 'done', expiring: 'warn', expired: 'late', missing: 'late' };

export function TrainingStatusBadge({ status }: { status: TrainingStatus }) {
  const { t } = useI18n();
  const label = { ok: t('hrTraining.statusOk'), expiring: t('hrTraining.statusExpiring'), expired: t('hrTraining.statusExpired'), missing: t('hrTraining.statusMissing') }[status];
  return <Badge tone={TONE[status]}>{label}</Badge>;
}

/**
 * A worker's training: what their team requires and how each stands, then
 * every training done, newest first. Only the latest of a kind counts.
 */
export function TrainingTab({ worker, kinds, trainings, today }: { worker: HrWorker; kinds: HrTrainingKind[]; trainings: HrTraining[]; today: string }) {
  const { t, locale, formatDate } = useI18n();
  const [editing, setEditing] = useState<HrTraining | 'new' | null>(null);
  const required = requiredTrainings(worker, kinds, trainings, today);
  const latest = new Set([...latestTrainings(trainings).values()].map((x) => x.id));
  const kindName = (id: string) => {
    const kind = kinds.find((k) => k.id === id);
    return kind ? localizedName(kind, locale) : '—';
  };
  const activeKinds = kinds.filter((k) => k.is_active);

  return (
    <div className="space-y-4">
      <section>
        <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('hrTraining.required')}</p>
        {required.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t('hrTraining.requiredNone')}</p>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {required.map((r) => (
                <li key={r.kind.id} className="flex items-center gap-2 px-3.5 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 break-words">{localizedName(r.kind, locale)}</span>
                  {r.latest?.expires_on && (
                    <span className="tabular text-[12px] text-muted">{t('hrTraining.expiresOn')} {formatDate(r.latest.expires_on, 'medium')}</span>
                  )}
                  <TrainingStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('hrTraining.history')}</p>
          {activeKinds.length > 0 && (
            <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('hrTraining.add')}
            </Button>
          )}
        </div>
        {activeKinds.length === 0 && <p className="mb-2 text-[12.5px] text-warn">{t('hrTraining.noKinds')}</p>}
        {trainings.length === 0 ? (
          <EmptyState title={t('hrTraining.none')} />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {trainings.map((tr) => (
                <li key={tr.id} className={cn('flex items-start gap-2 px-3.5 py-2 text-[13px]', !latest.has(tr.id) && 'opacity-60')}>
                  <span className="w-24 shrink-0 tabular text-muted">{formatDate(tr.done_on, 'medium')}</span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{kindName(tr.kind_id)}</p>
                    <p className="break-words text-[12px] text-muted">
                      {[
                        tr.expires_on ? `${t('hrTraining.expiresOn')} ${formatDate(tr.expires_on, 'medium')}` : t('hrTraining.noExpiry'),
                        tr.provider,
                        tr.hours !== null && `${Number(tr.hours)} h`,
                        !latest.has(tr.id) && t('hrTraining.replaced'),
                      ].filter(Boolean).join(' · ')}
                    </p>
                    {tr.note && <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px]">{tr.note}</p>}
                  </div>
                  <Button size="icon" variant="ghost" aria-label={t('hrTraining.edit')} onClick={() => setEditing(tr)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {editing && (
        <TrainingDialog workerId={worker.id} kinds={kinds} training={editing === 'new' ? null : editing} today={today} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function TrainingDialog({
  workerId,
  kinds,
  training,
  today,
  onClose,
}: {
  workerId: string;
  kinds: HrTrainingKind[];
  training: HrTraining | null;
  today: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const hrError = useHrError();
  const errorText = (e: string) =>
    e === 'expiry_before_done' ? t('hrTraining.errExpiryBeforeDone') : e === 'kind_required' ? t('hrTraining.errKindRequired') : hrError(e);
  const choices = kinds.filter((k) => k.is_active || k.id === training?.kind_id);
  const [form, setForm] = useState({
    kind_id: training?.kind_id ?? '',
    done_on: training?.done_on ?? today,
    expires_on: training?.expires_on ?? '',
    provider: training?.provider ?? '',
    hours: training?.hours !== null && training?.hours !== undefined ? String(Number(training.hours)) : '',
    note: training?.note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The expiry follows the kind and the date until it is typed by hand.
  const [expiryTouched, setExpiryTouched] = useState(Boolean(training));
  function change(patch: Partial<typeof form>) {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (!expiryTouched && ('kind_id' in patch || 'done_on' in patch)) {
        const kind = kinds.find((k) => k.id === next.kind_id);
        next.expires_on = (kind && next.done_on && defaultExpiry(next.done_on, kind.validity_months)) || '';
      }
      return next;
    });
  }

  function run(action: () => ReturnType<typeof saveTraining>) {
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
      title={training ? t('hrTraining.edit') : t('hrTraining.add')}
      className="max-w-md"
      footer={
        <>
          {training && (
            <Button variant="ghost" className="mr-auto text-late" onClick={() => run(() => deleteTraining(workerId, training.id))} disabled={pending}>
              {t('hrTraining.remove')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!form.kind_id || !form.done_on}
            onClick={() =>
              run(() =>
                saveTraining(
                  workerId,
                  {
                    kind_id: form.kind_id,
                    done_on: form.done_on,
                    expires_on: form.expires_on || null,
                    provider: form.provider,
                    hours: form.hours ? Number(form.hours.replace(',', '.')) : null,
                    note: form.note,
                  },
                  training?.id,
                ),
              )
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('hrTraining.kind')} required htmlFor="hr-training-kind">
          <Select id="hr-training-kind" value={form.kind_id} onChange={(e) => change({ kind_id: e.target.value })}>
            <option value="" disabled>—</option>
            {choices.map((k) => (
              <option key={k.id} value={k.id}>{localizedName(k, locale)}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hrTraining.doneOn')} required htmlFor="hr-training-done">
            <Input id="hr-training-done" type="date" value={form.done_on} onChange={(e) => change({ done_on: e.target.value })} />
          </Field>
          <Field label={t('hrTraining.expiresOn')} htmlFor="hr-training-expires">
            <Input
              id="hr-training-expires"
              type="date"
              value={form.expires_on}
              onChange={(e) => { setExpiryTouched(true); setForm((f) => ({ ...f, expires_on: e.target.value })); }}
            />
          </Field>
        </div>
        <p className="-mt-2 text-[11.5px] text-muted">{t('hrTraining.expiresHint')}</p>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label={t('hrTraining.provider')} htmlFor="hr-training-provider">
            <Input id="hr-training-provider" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} />
          </Field>
          <Field label={t('hrTraining.hours')} htmlFor="hr-training-hours">
            <Input id="hr-training-hours" inputMode="decimal" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} />
          </Field>
        </div>
        <Field label={t('hrTraining.note')} htmlFor="hr-training-note">
          <NoteTextarea id="hr-training-note" rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  );
}
