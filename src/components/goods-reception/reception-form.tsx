'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import {
  QUANTITY_CHECKS,
  RECEPTION_CONDITIONS,
} from '@/domain/goods-reception/vocabulary';
import { createReception, updateReception } from '@/server/goods-reception-actions';
import type { ReceptionInput } from '@/server/goods-reception-actions';
import type { GoodsReception, Supplier, Transporter } from '@/types/goods-reception';
import { fromLocalInput, toLocalInput, useReceptionError, useReceptionLabels } from './reception-bits';

/**
 * Registering a delivery.
 *
 * §32: the person filling this in is standing next to a pallet with a driver
 * waiting. So the field order is the order a delivery actually presents
 * itself — who brought it, from whom, on what paper — and only ONE field is
 * required to save: none of them.
 *
 * There is no product table on this form, and that is the point of the whole
 * module. The delivery note already lists every article; anything unusual
 * about one of them is recorded afterwards as an exception, on the detail
 * page, where there is time to type.
 */
export function ReceptionForm({
  reception,
  suppliers,
  transporters,
  onClose,
}: {
  /** Absent when registering a new delivery. */
  reception?: GoodsReception;
  suppliers: Supplier[];
  transporters: Transporter[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useReceptionLabels();
  const translateError = useReceptionError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState(reception?.supplier_id ?? '');
  const [transporterId, setTransporterId] = useState(reception?.transporter_id ?? '');
  const [deliveryNote, setDeliveryNote] = useState(reception?.delivery_note ?? '');
  // §14: defaults to now, correctable by hand. A delivery registered an hour
  // after it arrived should say when it arrived, not when somebody typed.
  const [receivedAt, setReceivedAt] = useState(() =>
    toLocalInput(reception?.received_at ?? new Date().toISOString()),
  );
  const [condition, setCondition] = useState(reception?.condition ?? '');
  const [quantityCheck, setQuantityCheck] = useState(reception?.quantity_check ?? 'not_checked');
  const [comments, setComments] = useState(reception?.comments ?? '');

  /*
   * A discrepancy with nothing written down cannot be COMPLETED, but it can
   * certainly be saved — the receiver may not know yet what is missing. The
   * warning says what will be needed later rather than blocking now.
   */
  const discrepancyUnexplained =
    quantityCheck === 'discrepancy' && comments.trim().length === 0;

  function submit() {
    const input: ReceptionInput = {
      supplier_id: supplierId || null,
      transporter_id: transporterId || null,
      delivery_note: deliveryNote.trim() || null,
      received_at: fromLocalInput(receivedAt),
      condition: (condition || null) as ReceptionInput['condition'],
      quantity_check: quantityCheck as ReceptionInput['quantity_check'],
      comments: comments.trim() || null,
      // Saving never advances the workflow on its own. Moving to RECEIVED or
      // CHECKING is an explicit act on the detail page, and completion has a
      // button of its own — a form that quietly promoted a draft would make
      // "still open" meaningless.
      status: reception?.status ?? 'draft',
    };

    startTransition(async () => {
      const res = reception
        ? await updateReception(reception.id, input)
        : await createReception(input);

      if (!res.ok) {
        setError(translateError(res.error));
        return;
      }

      onClose();
      if (!reception && typeof res.data === 'string') router.push(`/goods-reception/${res.data}`);
      else router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={reception ? reception.reception_number : t('gr.newReception')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {reception ? t('gr.save') : t('gr.saveDraft')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('gr.supplier')} htmlFor="gr-supplier">
          <Select
            id="gr-supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('gr.transporter')} hint={t('gr.noTransporter')} htmlFor="gr-transporter">
          <Select
            id="gr-transporter"
            value={transporterId}
            onChange={(e) => setTransporterId(e.target.value)}
          >
            <option value="">—</option>
            {transporters.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('gr.deliveryNote')} htmlFor="gr-note">
          <Input
            id="gr-note"
            value={deliveryNote}
            inputMode="numeric"
            onChange={(e) => setDeliveryNote(e.target.value)}
          />
        </Field>

        <Field label={t('gr.receivedAt')} htmlFor="gr-received-at">
          <Input
            id="gr-received-at"
            type="datetime-local"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
          />
        </Field>

        <Field label={t('gr.condition')} htmlFor="gr-condition">
          <Select
            id="gr-condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value as typeof condition)}
          >
            <option value="">—</option>
            {RECEPTION_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {labels.condition(c)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('gr.quantityCheck')}
          htmlFor="gr-quantity"
          hint={discrepancyUnexplained ? t('gr.error.discrepancy_needs_explanation') : undefined}
        >
          <Select
            id="gr-quantity"
            value={quantityCheck}
            onChange={(e) => setQuantityCheck(e.target.value as typeof quantityCheck)}
          >
            {QUANTITY_CHECKS.map((q) => (
              <option key={q} value={q}>
                {labels.quantity(q)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('gr.comments')} hint={t('gr.commentsHint')} htmlFor="gr-comments">
          <Textarea
            id="gr-comments"
            value={comments}
            maxLength={2000}
            onChange={(e) => setComments(e.target.value)}
          />
        </Field>

        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
