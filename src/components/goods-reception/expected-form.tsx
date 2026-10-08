'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { addDays } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { LINE_UNITS, STORAGE_TYPES, formatQuantity, mondayOf, type LineUnit, type StorageType } from '@/domain/goods-reception/expected';
import { saveExpectedDelivery } from '@/server/expected-delivery-actions';
import { productLabel, type Product } from '@/types/orders';
import type { ExpectedDelivery, Supplier, Transporter } from '@/types/goods-reception';
import { useExpectedError, useExpectedLabels } from './expected-bits';

interface DraftLine {
  key: string;
  /** From the catalogue, or typed. */
  source: 'catalogue' | 'text';
  product_id: string | null;
  description: string;
  quantity: string;
  unit: LineUnit;
}

let nextKey = 0;
const blankLine = (): DraftLine => ({ key: `new-${nextKey++}`, source: 'catalogue', product_id: null, description: '', quantity: '', unit: 'boxes' });

/**
 * Announcing a delivery: who, when, how much room it needs and where —
 * and, when the office knows, what is on it.
 *
 * The day can be left as a week while the supplier has not confirmed; it is
 * made exact later with the same form.
 */
export function ExpectedForm({
  delivery,
  suppliers,
  transporters,
  products,
  today,
  onClose,
}: {
  /** Absent when announcing a new one. */
  delivery?: ExpectedDelivery;
  suppliers: Supplier[];
  transporters: Transporter[];
  products: Product[];
  today: string;
  onClose: () => void;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useExpectedLabels();
  const translateError = useExpectedError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState(delivery?.supplier_id ?? '');
  const [transporterId, setTransporterId] = useState(delivery?.transporter_id ?? '');
  const [mode, setMode] = useState<'day' | 'week'>(delivery?.expected_week ? 'week' : 'day');
  const [date, setDate] = useState(delivery?.expected_date ?? delivery?.expected_week ?? '');
  const [pallets, setPallets] = useState(delivery?.pallets ? String(delivery.pallets) : '');
  const [storage, setStorage] = useState<StorageType[]>(delivery?.storage ?? []);
  const [note, setNote] = useState(delivery?.note ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    () =>
      delivery?.lines.map((l) => ({
        key: l.id,
        source: l.product_id ? ('catalogue' as const) : ('text' as const),
        product_id: l.product_id,
        description: l.description ?? '',
        quantity: formatQuantity(l.quantity),
        unit: l.unit,
      })) ?? [],
  );

  const patch = (key: string, change: Partial<DraftLine>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l)));

  // A line somebody started and left empty is dropped rather than refused.
  const filled = lines.filter((l) => (l.source === 'catalogue' ? l.product_id : l.description.trim()) || l.quantity);
  const linesValid = filled.every(
    (l) => (l.source === 'catalogue' ? Boolean(l.product_id) : l.description.trim().length > 0) && Number(l.quantity) > 0,
  );
  const ready = supplierId !== '' && date !== '' && storage.length > 0 && linesValid;
  const monday = mode === 'week' && date ? mondayOf(date) : null;

  function submit() {
    startTransition(async () => {
      const res = await saveExpectedDelivery(delivery?.id ?? null, {
        supplier_id: supplierId,
        transporter_id: transporterId || null,
        expected_date: mode === 'day' ? date : null,
        expected_week: mode === 'week' ? date : null,
        pallets: pallets ? Number(pallets) : null,
        storage,
        note: note.trim() || null,
        lines: filled.map((l) => ({
          product_id: l.source === 'catalogue' ? l.product_id : null,
          description: l.source === 'text' ? l.description.trim() : null,
          quantity: Number(l.quantity),
          unit: l.unit,
        })),
      });
      if (!res.ok) return setError(translateError(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={delivery ? t('grx.edit') : t('grx.new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} disabled={!ready} onClick={submit}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('gr.supplier')} htmlFor="grx-supplier" required>
          <Select id="grx-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">—</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>

        <Field
          label={t('grx.when')}
          htmlFor="grx-date"
          required
          hint={
            monday
              ? t('grx.weekRange', { from: formatDate(monday, 'short'), to: formatDate(addDays(monday, 4), 'short') })
              : mode === 'week' ? t('grx.weekHint') : undefined
          }
        >
          <div className="mb-1.5 flex gap-1 rounded-lg bg-surface-2 p-1">
            {(['day', 'week'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                  mode === m ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
                )}
              >
                {t(m === 'day' ? 'grx.exactDay' : 'grx.approxWeek')}
              </button>
            ))}
          </div>
          <Input id="grx-date" type="date" min={delivery ? undefined : today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('grx.pallets')} htmlFor="grx-pallets">
            <Input id="grx-pallets" type="number" inputMode="numeric" min="1" step="1" value={pallets} onChange={(e) => setPallets(e.target.value)} />
          </Field>
          <Field label={t('gr.transporter')} htmlFor="grx-transporter">
            <Select id="grx-transporter" value={transporterId} onChange={(e) => setTransporterId(e.target.value)}>
              <option value="">—</option>
              {transporters.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
            </Select>
          </Field>
        </div>

        <Field label={t('grx.storage')} required>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {STORAGE_TYPES.map((s) => (
              <Checkbox
                key={s}
                label={labels.storage(s)}
                checked={storage.includes(s)}
                onChange={(e) => setStorage((all) => (e.target.checked ? [...all, s] : all.filter((x) => x !== s)))}
              />
            ))}
          </div>
        </Field>

        <Field label={t('grx.note')} hint={t('grx.noteHint')} htmlFor="grx-note">
          <NoteTextarea id="grx-note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <Field label={t('grx.lines')} hint={t('grx.linesHint')}>
          <ul className="space-y-2">
            {lines.map((line) => (
              <li key={line.key} className="space-y-1.5 rounded-lg border border-border p-2">
                <div className="flex items-center gap-1.5">
                  <Select
                    aria-label={t('grx.lineSource')}
                    className="w-28 shrink-0"
                    value={line.source}
                    onChange={(e) => patch(line.key, { source: e.target.value as DraftLine['source'], product_id: null, description: '' })}
                  >
                    <option value="catalogue">{t('grx.fromCatalogue')}</option>
                    <option value="text">{t('grx.freeText')}</option>
                  </Select>
                  <div className="min-w-0 flex-1">
                    {line.source === 'catalogue' ? (
                      <Combobox
                        items={products}
                        value={line.product_id}
                        onChange={(id) => patch(line.key, { product_id: id })}
                        getKey={(p) => p.id}
                        getLabel={(p) => productLabel(p)}
                        getSearchText={(p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family} ${p.presentation}`}
                        placeholder={t('gr.product')}
                      />
                    ) : (
                      <Input
                        aria-label={t('grx.lineText')}
                        placeholder={t('grx.lineText')}
                        maxLength={200}
                        value={line.description}
                        onChange={(e) => patch(line.key, { description: e.target.value })}
                      />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.001"
                    aria-label={t('grx.quantity')}
                    placeholder={t('grx.quantity')}
                    className="min-w-0 flex-1"
                    value={line.quantity}
                    onChange={(e) => patch(line.key, { quantity: e.target.value })}
                  />
                  <Select aria-label={t('grx.unit')} className="w-28 shrink-0" value={line.unit} onChange={(e) => patch(line.key, { unit: e.target.value as LineUnit })}>
                    {LINE_UNITS.map((u) => <option key={u} value={u}>{labels.unit(u)}</option>)}
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('grx.removeLine')}
                    onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className={cn(lines.length > 0 && 'mt-2')} onClick={() => setLines((all) => [...all, blankLine()])}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('grx.addLine')}
          </Button>
        </Field>

        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
