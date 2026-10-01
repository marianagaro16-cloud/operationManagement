'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Factory, Pencil } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { getProductionContext, recordProduction, setProductionTarget, type ProductionContext } from '@/server/production-actions';
import type { ProductionRecord } from '@/types/database';

export const SHORTFALL_LABEL: Record<NonNullable<ProductionRecord['shortfall_reason']>, MessageKey> = {
  raw_material: 'production.reasonRawMaterial',
  packaging: 'production.reasonPackaging',
  time: 'production.reasonTime',
  damaged: 'production.reasonDamaged',
  other: 'production.reasonOther',
};

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/** "18 / 20 · cad. 01.04.27" — what was made, on the activity. */
export function ProductionSummary({ record }: { record: ProductionRecord }) {
  const { t, formatDate } = useI18n();
  const short = Number(record.produced_quantity) < Number(record.target_quantity);
  return (
    <div className="mt-1.5 rounded-md bg-surface-2 px-2 py-1 text-[12px]">
      <span className={cn('font-semibold tabular', short ? 'text-warn' : 'text-done')}>
        {t('production.produced', { produced: qty(Number(record.produced_quantity)), target: qty(Number(record.target_quantity)) })}
      </span>
      {record.best_before && <span className="text-muted"> · {t('production.bestBeforeShort', { date: formatDate(record.best_before, 'short') })}</span>}
      {record.shortfall_reason && (
        <span className="text-muted">
          {' · '}
          {t(SHORTFALL_LABEL[record.shortfall_reason])}
          {record.shortfall_note && `: ${record.shortfall_note}`}
        </span>
      )}
    </div>
  );
}

/** Change how many to make on this one day — whoever plans work. */
export function ProductionTargetButton({ occurrenceId, current, onDone }: { occurrenceId: string; current: number; onDone?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(qty(current));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amount = Number(value.replace(',', '.'));

  function save() {
    if (!(amount > 0)) return;
    setError(null);
    startTransition(async () => {
      const res = await setProductionTarget(occurrenceId, amount);
      if (!res.ok) return setError(res.error === 'not_authorized' ? t('production.errNotAuthorized') : t('common.error'));
      setOpen(false);
      onDone?.();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setValue(qty(current)); setOpen(true); }}
        aria-label={t('production.changeQuantity')}
        title={t('production.changeQuantity')}
        className="ml-1 rounded p-0.5 text-accent/70 hover:bg-accent/10 hover:text-accent"
      >
        <Pencil className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={t('production.changeQuantity')}
          description={t('production.changeQuantityHint')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={save} loading={pending} disabled={!(amount > 0)}>{t('common.save')}</Button>
            </>
          }
        >
          {error && <div className="mb-2"><ErrorState message={error} /></div>}
          <Field label={t('production.quantity')} required htmlFor="prod-target">
            <Input id="prod-target" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus className="w-32 tabular" />
          </Field>
        </Dialog>
      )}
    </>
  );
}

/**
 * Record what was made — which completes the day. Opened with what the screen
 * already knows, or just the day's id (then fetched).
 */
export function ProductionDialog({
  occurrenceId,
  known,
  onClose,
  onDone,
}: {
  occurrenceId: string;
  known?: Omit<ProductionContext, 'occurrence_id' | 'due_date'> | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [ctx, setCtx] = useState<Omit<ProductionContext, 'occurrence_id' | 'due_date'> | null>(known ?? null);
  const record = ctx?.record ?? null;
  const [produced, setProduced] = useState('');
  const [bestBefore, setBestBefore] = useState('');
  const [reason, setReason] = useState<ProductionRecord['shortfall_reason'] | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (ctx) return;
    getProductionContext(occurrenceId).then((res) => (res.ok ? setCtx(res.data) : setError(t('common.error'))));
  }, [ctx, occurrenceId, t]);

  // Start from what was recorded before, or from the target.
  useEffect(() => {
    if (!ctx) return;
    setProduced(record ? qty(Number(record.produced_quantity)) : qty(ctx.target_quantity));
    setBestBefore(record?.best_before ?? '');
    setReason(record?.shortfall_reason ?? '');
    setNote(record?.shortfall_note ?? '');
  }, [ctx, record]);

  const amount = Number(produced.replace(',', '.'));
  const valid = produced.trim() !== '' && Number.isFinite(amount) && amount >= 0;
  const short = ctx !== null && valid && amount < ctx.target_quantity;
  const ready = valid && (amount === 0 || bestBefore !== '') && (!short || reason !== '');

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await recordProduction({
        occurrence_id: occurrenceId,
        produced: amount,
        lot: null,
        best_before: bestBefore || null,
        reason: short ? (reason || null) : null,
        note: note.trim() || null,
      });
      if (!res.ok) {
        const map: Record<string, MessageKey> = {
          lot_required: 'production.errLot',
          best_before_required: 'production.errBestBefore',
          reason_required: 'production.errReason',
          not_authorized: 'production.errNotAuthorized',
        };
        return setError(map[res.error] ? t(map[res.error]) : t('common.error'));
      }
      onClose();
      onDone?.();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('production.record')}
      description={ctx ? t('production.target', { target: qty(ctx.target_quantity), product: ctx.product_name }) : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="success" onClick={submit} loading={pending} disabled={!ready || !ctx}>
            <Factory className="h-3.5 w-3.5" aria-hidden />
            {t('production.save')}
          </Button>
        </>
      }
    >
      {!ctx ? (
        error ? <ErrorState message={error} /> : <p className="text-[13px] text-muted">…</p>
      ) : (
        <div className="space-y-3">
          {error && <ErrorState message={error} />}
          <Field label={t('production.unitsProduced')} required htmlFor="prod-qty">
            <Input id="prod-qty" inputMode="decimal" value={produced} onChange={(e) => setProduced(e.target.value)} autoFocus className="w-32 tabular" />
          </Field>
          {amount > 0 && (
            <Field label={t('production.bestBefore')} required htmlFor="prod-bb">
              <Input id="prod-bb" type="date" value={bestBefore} onChange={(e) => setBestBefore(e.target.value)} className="w-auto" />
            </Field>
          )}
          {short && (
            <>
              <Field label={t('production.whyFewer')} required htmlFor="prod-reason">
                <Select id="prod-reason" value={reason ?? ''} onChange={(e) => setReason(e.target.value as typeof reason)}>
                  <option value="">—</option>
                  {(Object.keys(SHORTFALL_LABEL) as (keyof typeof SHORTFALL_LABEL)[]).map((k) => (
                    <option key={k} value={k}>{t(SHORTFALL_LABEL[k])}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('production.note')} htmlFor="prod-note">
                <NoteTextarea id="prod-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
              </Field>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
