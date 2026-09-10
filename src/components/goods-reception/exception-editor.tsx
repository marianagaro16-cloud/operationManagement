'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, PackageSearch, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  SectionHeading,
  Textarea,
} from '@/components/ui/primitives';
import {
  addReceptionEvidence,
  addReceptionException,
  deleteReceptionException,
} from '@/server/goods-reception-actions';
import type { ReceptionDetail, ReceptionException } from '@/types/goods-reception';
import type { Product } from '@/types/orders';
import { useReceptionError } from './reception-bits';

/**
 * Exceptional product information.
 *
 * THE SECTION THAT MOST NEEDS TO STAY SMALL. §7 and §22: this is not a list
 * of what arrived. Zero rows is the ordinary case and the empty state says so
 * plainly, because a screen that looks like it wants filling gets filled —
 * and a Goods Reception that lists every article is a delivery note typed
 * twice, which is exactly what this module exists to avoid.
 *
 * Lot and MHD live here and nowhere else. Recording them creates no inventory
 * lot, touches no stock and reaches no expiry report. They are notes about
 * what arrived, on the record of what arrived.
 */
export function ExceptionEditor({
  reception,
  products,
  canEdit,
}: {
  reception: ReceptionDetail;
  products: Product[];
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-0">
        <SectionHeading
          title={t('gr.exceptions')}
          subtitle={t('gr.exceptionsHint')}
          action={
            canEdit ? (
              <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('gr.addException')}
              </Button>
            ) : undefined
          }
        />
      </CardHeader>

      <CardBody>
        {reception.exceptions.length === 0 ? (
          <p className="text-[13px] text-muted">{t('gr.noExceptions')}</p>
        ) : (
          <ul className="space-y-2">
            {reception.exceptions.map((exception) => (
              <li key={exception.id}>
                <ExceptionRow
                  exception={exception}
                  receptionId={reception.id}
                  canEdit={canEdit}
                />
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      {adding && (
        <ExceptionDialog
          receptionId={reception.id}
          products={products}
          onClose={() => setAdding(false)}
        />
      )}
    </Card>
  );
}

function ExceptionRow({
  exception,
  receptionId,
  canEdit,
}: {
  exception: ReceptionException;
  receptionId: string;
  canEdit: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const translateError = useReceptionError();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const product = exception.product;
  const productName = product ? `${product.family} · ${product.presentation}` : '—';

  function attach(files: FileList | null) {
    if (!files?.length) return;
    startTransition(async () => {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set('reception_id', receptionId);
        // Narrows the photo to this exception, so the damage appears beside
        // the sentence describing it rather than loose in the gallery.
        form.set('exception_id', exception.id);
        form.set('file', file);
        const res = await addReceptionEvidence(form);
        if (!res.ok) {
          setError(translateError(res.error));
          return;
        }
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">{productName}</p>

          <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted">
            {exception.lot_number && (
              <span>
                {t('gr.lot')}: <span className="font-mono">{exception.lot_number}</span>
              </span>
            )}
            {exception.best_before && (
              <span>
                {t('gr.mhd')}: {formatDate(exception.best_before, 'short')}
              </span>
            )}
            {exception.affected_quantity !== null && (
              <span>
                {t('gr.affectedQuantity')}: {String(exception.affected_quantity)}
              </span>
            )}
          </p>

          <p className="mt-1 whitespace-pre-wrap text-[13px]">{exception.description}</p>

          {exception.evidence && exception.evidence.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {exception.evidence.map((photo) =>
                photo.signed_url ? (
                  <li key={photo.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.signed_url}
                      alt={photo.file_name}
                      loading="lazy"
                      className="h-16 w-16 rounded-md border border-border object-cover"
                    />
                  </li>
                ) : null,
              )}
            </ul>
          )}

          {error && <p className="mt-1 text-[12px] text-late">{error}</p>}
        </div>

        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => attach(e.target.files)}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('gr.addPhoto')}
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              <Camera className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('common.delete')}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteReceptionException(exception.id, receptionId);
                  if (!res.ok) setError(translateError(res.error));
                  else router.refresh();
                })
              }
            >
              <Trash2 className="h-3.5 w-3.5 text-late" aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ExceptionDialog({
  receptionId,
  products,
  onClose,
}: {
  receptionId: string;
  products: Product[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = useReceptionError();
  const [productId, setProductId] = useState<string | null>(null);
  const [lot, setLot] = useState('');
  const [bestBefore, setBestBefore] = useState('');
  const [quantity, setQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = productId !== null && description.trim().length > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('gr.addException')}
      description={t('gr.exceptionsHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!ready}
            onClick={() =>
              startTransition(async () => {
                const res = await addReceptionException({
                  reception_id: receptionId,
                  product_id: productId!,
                  lot_number: lot.trim() || null,
                  best_before: bestBefore || null,
                  affected_quantity: quantity ? Number(quantity) : null,
                  description: description.trim(),
                });
                if (!res.ok) setError(translateError(res.error));
                else {
                  onClose();
                  router.refresh();
                }
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* §22: chosen from the existing master, never typed. Two spellings of
            one cheese would become two products in every later analysis. */}
        <Field label={t('gr.product')} required>
          <Combobox
            items={products}
            value={productId}
            onChange={setProductId}
            getKey={(p) => p.id}
            getLabel={(p) => `${p.family} · ${p.presentation}`}
            getSearchText={(p) => `${p.code ?? ''} ${p.family} ${p.presentation}`}
            placeholder={t('gr.product')}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('gr.lot')}>
            <Input value={lot} onChange={(e) => setLot(e.target.value)} />
          </Field>
          <Field label={t('gr.mhd')}>
            <Input
              type="date"
              value={bestBefore}
              onChange={(e) => setBestBefore(e.target.value)}
            />
          </Field>
        </div>

        <Field label={t('gr.affectedQuantity')}>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>

        <Field label={t('gr.description')} required>
          <Textarea
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}

/** Shown when the module has no products to offer at all. */
export function NoProductsNotice() {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted">
      <PackageSearch className="h-4 w-4" aria-hidden />
      {t('gr.noExceptions')}
    </p>
  );
}
