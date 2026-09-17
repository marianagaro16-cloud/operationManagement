'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { boxSize } from '@/components/orders/order-boxes';
import { formatKg } from '@/domain/orders/weight';
import { saveBoxType } from '@/server/order-actions';
import type { BoxType } from '@/types/orders';

/**
 * Box types: the boxes orders are packed in.
 *
 * Retired rather than deleted, because orders keep the boxes they shipped in.
 * The empty weight is what an order's gross weight adds per box.
 */
export function BoxTypeManager({ boxTypes }: { boxTypes: BoxType[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<BoxType | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title={t('master.boxTypesTitle')}
        subtitle={t('master.boxTypesSubtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('master.newBoxTypeShort')}
          </Button>
        }
      />

      {boxTypes.length === 0 ? (
        <EmptyState title={t('master.noBoxTypes')} body={t('master.noBoxTypesBody')} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {boxTypes.map((bt) => (
              <li key={bt.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-[13.5px]', !bt.is_active && 'text-muted line-through')}>{bt.name}</p>
                  <p className="truncate text-[11.5px] tabular text-muted">
                    {[boxSize(bt), formatKg(Number(bt.empty_weight_kg))].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge tone={bt.is_active ? 'done' : 'neutral'}>
                  {bt.is_active ? t('status.active') : t('status.inactive')}
                </Badge>
                <Button size="icon" variant="ghost" onClick={() => setEditing(bt)} aria-label={t('common.edit')}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(creating || editing) && (
        <BoxTypeDialog
          key={editing?.id ?? 'new'}
          boxType={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

const asText = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));
const asNumber = (v: string) => (v.trim() ? Number(v) : null);

function BoxTypeDialog({
  boxType,
  onClose,
  onSaved,
}: {
  boxType: BoxType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(boxType?.name ?? '');
  const [weight, setWeight] = useState(asText(boxType?.empty_weight_kg));
  const [length, setLength] = useState(asText(boxType?.length_cm));
  const [width, setWidth] = useState(asText(boxType?.width_cm));
  const [height, setHeight] = useState(asText(boxType?.height_cm));
  const [active, setActive] = useState(boxType?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveBoxType(
        {
          name: name.trim(),
          empty_weight_kg: Number(weight),
          length_cm: asNumber(length),
          width_cm: asNumber(width),
          height_cm: asNumber(height),
          is_active: active,
        },
        boxType?.id,
      );
      if (!res.ok) return setError(res.error === 'invalid_box_type' ? t('master.invalidBoxType') : res.error);
      onSaved();
    });
  }

  const sizeInput = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <Input
      id={id}
      type="number"
      min="0"
      step="any"
      inputMode="decimal"
      placeholder={label}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={boxType ? t('common.edit') : t('master.newBoxType')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!name.trim() || !weight.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label={t('master.name')} required htmlFor="bt-name">
          <Input id="bt-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label={t('master.emptyWeight')} hint={t('master.emptyWeightHint')} required htmlFor="bt-weight">
          <Input
            id="bt-weight"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </Field>

        <Field label={t('master.boxSize')} hint={t('master.boxSizeHint')} htmlFor="bt-length">
          <div className="grid grid-cols-3 gap-2">
            {sizeInput('bt-length', t('master.boxLength'), length, setLength)}
            {sizeInput('bt-width', t('master.boxWidth'), width, setWidth)}
            {sizeInput('bt-height', t('master.boxHeight'), height, setHeight)}
          </div>
        </Field>

        <Checkbox label={t('status.active')} hint={t('master.boxActiveHint')} checked={active} onChange={(e) => setActive(e.target.checked)} />

        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}
