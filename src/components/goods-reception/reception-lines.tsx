'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CopyPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, SectionHeading, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { LINE_UNITS, formatQuantity, type LineUnit } from '@/domain/goods-reception/expected';
import { copyExpectedLines, deleteReceptionLine, saveReceptionLine } from '@/server/reception-line-actions';
import { productLabel, type Product } from '@/types/orders';
import type { ReceptionLine } from '@/types/goods-reception';
import { useExpectedLabels } from './expected-bits';

/**
 * What arrived on this delivery: product, quantity, best-before (decided
 * 2026-10-14). Optional — the reception completes without it. Written by the
 * receivers while it is open, by the office at any time.
 */
export function ReceptionLines({
  receptionId,
  lines,
  products,
  canEdit,
  expectedLineCount = 0,
  today,
}: {
  receptionId: string;
  lines: ReceptionLine[];
  products: Product[];
  canEdit: boolean;
  /** Lines on the expected delivery this reception closed: offered to copy while none were entered. */
  expectedLineCount?: number;
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useExpectedLabels();
  const [editing, setEditing] = useState<ReceptionLine | 'new' | null>(null);
  const [removing, setRemoving] = useState<ReceptionLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canEdit && lines.length === 0) return null;

  const name = (l: ReceptionLine) => (l.product ? productLabel(l.product) : (l.description ?? ''));

  return (
    <Card>
      <CardHeader className="pb-0">
        <SectionHeading
          title={t('grLines.title')}
          action={
            canEdit ? (
              <div className="flex flex-wrap gap-1.5">
                {lines.length === 0 && expectedLineCount > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        const res = await copyExpectedLines(receptionId);
                        if (!res.ok) return setError(t('common.error'));
                        router.refresh();
                      })
                    }
                  >
                    <CopyPlus className="h-3.5 w-3.5" aria-hidden />
                    {t('grLines.copyExpected')}
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('grLines.add')}
                </Button>
              </div>
            ) : undefined
          }
        />
      </CardHeader>
      <CardBody>
        {lines.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t('grLines.hint')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lines.map((l) => {
              const expired = !!l.best_before && l.best_before < today;
              return (
                <li key={l.id} className="flex items-start gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-medium">{name(l)}</p>
                    <p className="text-[12px] text-muted">
                      {l.quantity !== null && `${formatQuantity(l.quantity)} ${labels.unit(l.unit)}`}
                      {l.lot_number && `${l.quantity !== null ? ' · ' : ''}${t('grLines.lot')} ${l.lot_number}`}
                    </p>
                    {l.note && <p className="text-[12px] text-muted">{l.note}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] uppercase tracking-wide text-subtle">{t('grLines.bestBefore')}</p>
                    <p className={cn('text-[13px] font-semibold tabular', !l.best_before ? 'font-normal text-subtle' : expired ? 'text-late' : 'text-fg')}>
                      {l.best_before ? formatDate(l.best_before, 'medium') : t('grLines.noDate')}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-0.5">
                      <Button size="icon" variant="ghost" aria-label={t('grLines.edit')} onClick={() => setEditing(l)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={t('grLines.remove')} onClick={() => setRemoving(l)}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="mt-2 text-[12.5px] text-late">{error}</p>}
      </CardBody>

      {editing && (
        <LineDialog
          receptionId={receptionId}
          line={editing === 'new' ? null : editing}
          products={products}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          startTransition(async () => {
            if (removing) {
              const res = await deleteReceptionLine(removing.id, receptionId);
              if (!res.ok) setError(t('common.error'));
            }
            setRemoving(null);
            router.refresh();
          })
        }
        title={t('grLines.remove')}
        message={t('grLines.removeConfirm')}
        confirmLabel={t('grLines.remove')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
    </Card>
  );
}

function LineDialog({
  receptionId,
  line,
  products,
  onClose,
}: {
  receptionId: string;
  line: ReceptionLine | null;
  products: Product[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useExpectedLabels();
  const [other, setOther] = useState(Boolean(line && !line.product_id));
  const [productId, setProductId] = useState<string | null>(line?.product_id ?? null);
  const [description, setDescription] = useState(line?.description ?? '');
  const [quantity, setQuantity] = useState(line?.quantity !== null && line?.quantity !== undefined ? formatQuantity(line.quantity) : '');
  const [unit, setUnit] = useState<LineUnit>(line?.unit ?? 'units');
  const [bestBefore, setBestBefore] = useState(line?.best_before ?? '');
  const [lot, setLot] = useState(line?.lot_number ?? '');
  const [note, setNote] = useState(line?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A product retired since keeps showing on its old line.
  const options = line?.product && !products.some((p) => p.id === line.product_id)
    ? [...products, line.product as Product]
    : products;

  function submit() {
    setError(null);
    if (other ? !description.trim() : !productId) return setError(t('grLines.errInvalid'));
    const qty = quantity.trim() === '' ? null : Number(quantity.replace(',', '.'));
    if (qty !== null && !(qty > 0)) return setError(t('grLines.quantity'));
    startTransition(async () => {
      const res = await saveReceptionLine({
        id: line?.id,
        reception_id: receptionId,
        product_id: other ? null : productId,
        description: other ? description : null,
        quantity: qty,
        unit,
        best_before: bestBefore || null,
        lot_number: lot,
        note,
      });
      if (!res.ok) return setError(res.error === 'invalid_line' ? t('grLines.errInvalid') : t('common.error'));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={line ? t('grLines.edit') : t('grLines.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {other ? (
          <Field label={t('grLines.description')} required htmlFor="gl-desc">
            <Input id="gl-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} autoFocus />
          </Field>
        ) : (
          <Field label={t('grLines.product')} required htmlFor="gl-product">
            <Combobox
              id="gl-product"
              items={options}
              value={productId}
              onChange={setProductId}
              getKey={(p) => p.id}
              getLabel={(p) => productLabel(p)}
              getSearchText={(p) => `${p.code ?? ''} ${productLabel(p)}`}
              placeholder={t('grLines.product')}
            />
          </Field>
        )}
        <Checkbox label={t('grLines.otherText')} checked={other} onChange={(e) => setOther(e.target.checked)} />

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('grLines.quantity')} htmlFor="gl-qty">
            <Input id="gl-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d.,]/g, ''))} />
          </Field>
          <Field label={t('grLines.unit')} htmlFor="gl-unit">
            <Select id="gl-unit" value={unit} onChange={(e) => setUnit(e.target.value as LineUnit)}>
              {LINE_UNITS.map((u) => (
                <option key={u} value={u}>{labels.unit(u)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('grLines.bestBefore')} htmlFor="gl-bb">
            <Input id="gl-bb" type="date" value={bestBefore} onChange={(e) => setBestBefore(e.target.value)} />
          </Field>
          <Field label={`${t('grLines.lot')} (${t('common.optional').toLowerCase()})`} htmlFor="gl-lot">
            <Input id="gl-lot" value={lot} onChange={(e) => setLot(e.target.value)} maxLength={80} />
          </Field>
        </div>
        <Field label={t('grLines.note')} htmlFor="gl-note">
          <Input id="gl-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {error && <p className="text-[12.5px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
