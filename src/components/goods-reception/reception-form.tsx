'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import {
  QUANTITY_CHECKS,
  RECEPTION_CONDITIONS,
} from '@/domain/goods-reception/vocabulary';
import { createReception, updateReception } from '@/server/goods-reception-actions';
import type { ReceptionInput } from '@/server/goods-reception-actions';
import { registerExpectedArrival } from '@/server/expected-delivery-actions';
import type { ExpectedDelivery, GoodsReception, Supplier, Transporter } from '@/types/goods-reception';
import { fromLocalInput, toLocalInput, useReceptionError, useReceptionLabels } from './reception-bits';
import { ExpectedLines, LoadBadges, initialReceived, toReceived, useExpectedError, useExpectedLabels } from './expected-bits';

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
 *
 * The one exception is a delivery the office announced: when the supplier has
 * one open, the form asks whether this is it, and its lines — if it has any —
 * are there to count against.
 */
export function ReceptionForm({
  reception,
  suppliers,
  transporters,
  expected = [],
  arrivalOf,
  onClose,
}: {
  /** Absent when registering a new delivery. */
  reception?: GoodsReception;
  suppliers: Supplier[];
  transporters: Transporter[];
  /** Deliveries still expected, as far as the viewer sees them; a new reception may be one of them. */
  expected?: ExpectedDelivery[];
  /** Opened from an expected delivery: it starts out chosen. */
  arrivalOf?: ExpectedDelivery;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useReceptionLabels();
  const translateError = useReceptionError();
  const translateExpectedError = useExpectedError();
  const expectedLabels = useExpectedLabels();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState(reception?.supplier_id ?? arrivalOf?.supplier_id ?? '');
  const [transporterId, setTransporterId] = useState(reception?.transporter_id ?? arrivalOf?.transporter_id ?? '');
  // "Is it this one?" — only asked of a new reception.
  const candidates = reception ? [] : expected.filter((d) => d.supplier_id === supplierId);
  const [arrivalId, setArrivalId] = useState(arrivalOf?.id ?? '');
  const arrival = candidates.find((d) => d.id === arrivalId) ?? null;
  const [received, setReceived] = useState<Record<string, string>>(() => initialReceived(arrivalOf?.lines ?? []));

  function chooseArrival(id: string) {
    const chosen = candidates.find((d) => d.id === id);
    setArrivalId(id);
    setReceived(initialReceived(chosen?.lines ?? []));
    if (chosen?.transporter_id && !transporterId) setTransporterId(chosen.transporter_id);
  }
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
      if (arrival) {
        const res = await registerExpectedArrival(input, arrival.id, toReceived(arrival.lines, received));
        if (!res.ok) {
          const message = translateExpectedError(res.error);
          setError(message === res.error ? translateError(res.error) : message);
          return;
        }
        onClose();
        // A difference goes straight to reporting it, already written.
        router.push(`/goods-reception/${res.data.id}${res.data.differs ? '?report=difference' : ''}`);
        return;
      }

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
            onChange={(e) => {
              setSupplierId(e.target.value);
              setArrivalId('');
            }}
          >
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        {candidates.length > 0 && (
          <fieldset className="space-y-1.5 rounded-lg border border-accent/30 bg-accent/5 p-3">
            <legend className="px-1 text-[13px] font-medium">{t('grx.suggestTitle')}</legend>
            {candidates.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name="gr-arrival"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  checked={arrivalId === d.id}
                  onChange={() => chooseArrival(d.id)}
                />
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
                  <span className="font-medium">{expectedLabels.when(d)}</span>
                  <LoadBadges delivery={d} />
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name="gr-arrival"
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                checked={arrivalId === ''}
                onChange={() => chooseArrival('')}
              />
              <span className="text-[13px]">{t('grx.suggestNone')}</span>
            </label>
          </fieldset>
        )}

        {arrival && arrival.lines.length > 0 && (
          <Field label={t('grx.compareTitle')} hint={t('grx.compareHint')}>
            <ExpectedLines
              lines={arrival.lines}
              received={received}
              onReceived={(id, value) => setReceived((all) => ({ ...all, [id]: value }))}
            />
          </Field>
        )}

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
          <NoteTextarea
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
