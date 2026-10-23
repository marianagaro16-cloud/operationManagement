'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { COST_KINDS, DRIVER_COST_KINDS, RECEIPT_BUCKET, type CostKind } from '@/domain/vehicle/summary';
import { deleteCost, saveCost } from '@/server/vehicle-actions';
import type { VehicleCost } from '@/server/vehicle';
import { useCostKindLabel, useVehicleError } from './vehicle-bits';

const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * A cost of the van. The driver enters what is paid on the road — fuel,
 * parking, tolls, fines — with a photo of the receipt; the office enters the
 * rest. Fuel also asks the litres and the km, which is what turns a receipt
 * into "litres per 100 km".
 */
export function CostDialog({
  cost,
  viewerId,
  office,
  today,
  onClose,
}: {
  /** Absent when entering a new one. */
  cost?: VehicleCost;
  viewerId: string;
  /** The office enters every kind; a driver the road ones. */
  office: boolean;
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const kindLabel = useCostKindLabel();
  const translateError = useVehicleError();
  const supabase = useMemo(() => createClient(), []);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const kinds = office ? COST_KINDS : DRIVER_COST_KINDS;
  const [kind, setKind] = useState<CostKind>(cost?.kind ?? 'fuel');
  const [spentOn, setSpentOn] = useState(cost?.spent_on ?? today);
  const [amount, setAmount] = useState(cost ? String(Number(cost.amount)) : '');
  const [litres, setLitres] = useState(cost?.litres != null ? String(Number(cost.litres)) : '');
  const [km, setKm] = useState(cost?.odometer_km != null ? String(cost.odometer_km) : '');
  const [note, setNote] = useState(cost?.note ?? '');
  const [file, setFile] = useState<File | null>(null);

  const fuel = kind === 'fuel';
  const ready = Number(amount) > 0 && spentOn !== '' && (!litres || Number(litres) > 0) && (!km || Number(km) >= 0);

  function done(res: { ok: true } | { ok: false; error: string }) {
    if (!res.ok) return setError(translateError(res.error));
    onClose();
    router.refresh();
  }

  function submit() {
    setError(null);
    if (file && (!RECEIPT_TYPES.includes(file.type) || file.size > MAX_BYTES)) return setError(t('palomo.error.receipt_type'));
    startTransition(async () => {
      let receiptPath = cost?.receipt_path ?? null;
      if (file) {
        // Straight from the phone to storage, into the person's own folder.
        const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `${viewerId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) return setError(translateError('receipt_upload'));
        receiptPath = path;
      }
      done(
        await saveCost(cost?.id ?? null, {
          kind,
          spent_on: spentOn,
          amount: Number(amount),
          litres: fuel && litres ? Number(litres) : null,
          odometer_km: km ? Number(km) : null,
          note: note.trim() || null,
          receipt_path: receiptPath,
        }),
      );
    });
  }

  function remove() {
    if (!cost || !window.confirm(t('palomo.deleteCostConfirm'))) return;
    startTransition(async () => done(await deleteCost(cost.id)));
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(cost ? 'palomo.editCost' : 'palomo.newCost')}
      footer={
        <>
          {cost && (
            <Button variant="ghost" onClick={remove} disabled={pending} className="mr-auto text-late">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t('common.delete')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} disabled={!ready} onClick={submit}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('palomo.kindLabel')} htmlFor="cost-kind" required>
            <Select id="cost-kind" value={kind} onChange={(e) => setKind(e.target.value as CostKind)}>
              {kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
            </Select>
          </Field>
          <Field label={t('palomo.spentOn')} htmlFor="cost-date" required>
            <Input id="cost-date" type="date" max={today} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('palomo.amount')} htmlFor="cost-amount" required>
            <Input id="cost-amount" type="number" inputMode="decimal" min="0" step="0.05" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {fuel && (
            <Field label={t('palomo.litres')} htmlFor="cost-litres">
              <Input id="cost-litres" type="number" inputMode="decimal" min="0" step="0.01" value={litres} onChange={(e) => setLitres(e.target.value)} />
            </Field>
          )}
          {fuel && (
            <Field label={t('palomo.odometer')} htmlFor="cost-km">
              <Input id="cost-km" type="number" inputMode="numeric" min="0" step="1" value={km} onChange={(e) => setKm(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label={t('palomo.receipt')} hint={cost?.receipt_url && !file ? undefined : t('palomo.receiptHint')} htmlFor="cost-receipt">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
              <Camera className="h-3.5 w-3.5" aria-hidden />
              {file ? file.name : t(cost?.receipt_path ? 'palomo.receiptReplace' : 'palomo.receiptAdd')}
              <input
                id="cost-receipt"
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {cost?.receipt_url && !file && (
              <a href={cost.receipt_url} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-accent hover:underline">
                {t('palomo.receiptOpen')}
              </a>
            )}
          </div>
        </Field>
        <Field label={t('palomo.note')} htmlFor="cost-note">
          <NoteTextarea id="cost-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
