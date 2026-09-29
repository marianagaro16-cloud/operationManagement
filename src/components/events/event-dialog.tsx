'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { localizedName } from '@/lib/localized-content';
import { saveEvent } from '@/server/event-actions';
import type { EventListEntry, EventRow } from '@/types/events';
import { useEventLabels } from './event-parts';

export interface EventChoices {
  kinds: EventListEntry[];
  people: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  viewerId: string;
}

/** A new event (an idea), or changing one. */
export function EventDialog({
  event,
  choices,
  today,
  onClose,
}: {
  event: EventRow | null;
  choices: EventChoices;
  today: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const kinds = choices.kinds.filter((k) => k.is_active || k.id === event?.kind_id);
  const [kindId, setKindId] = useState(event?.kind_id ?? kinds[0]?.id ?? '');
  const [name, setName] = useState(event?.name ?? '');
  const [start, setStart] = useState(event?.start_date ?? today);
  const [end, setEnd] = useState(event?.end_date ?? today);
  const [open, setOpen] = useState(event?.open_time?.slice(0, 5) ?? '');
  const [close, setClose] = useState(event?.close_time?.slice(0, 5) ?? '');
  const [placeName, setPlaceName] = useState(event?.place_name ?? '');
  const [street, setStreet] = useState(event?.street ?? '');
  const [postal, setPostal] = useState(event?.postal_code ?? '');
  const [city, setCity] = useState(event?.city ?? '');
  const [customerId, setCustomerId] = useState<string | null>(event?.customer_id ?? null);
  // Whoever creates it is responsible, when they are in sales.
  const [ownerId, setOwnerId] = useState(
    event ? event.owner_id ?? '' : choices.people.some((p) => p.id === choices.viewerId) ? choices.viewerId : '',
  );
  const [description, setDescription] = useState(event?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = !!name.trim() && !!kindId && !!start && !!end && end >= start;

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await saveEvent(
        {
          kind_id: kindId,
          name,
          start_date: start,
          end_date: end,
          open_time: open || null,
          close_time: close || null,
          place_name: placeName,
          street,
          postal_code: postal,
          city,
          customer_id: customerId,
          owner_id: ownerId || null,
          description,
        },
        event?.id,
      );
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      if (event) router.refresh();
      else router.push(`/events/${res.data.id}`);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={event ? t('event.edit') : t('event.new')}
      description={event ? undefined : t('event.newHint')}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('event.name')} required htmlFor="event-name">
          <Input id="event-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('event.kind')} required htmlFor="event-kind">
          <Select id="event-kind" value={kindId} onChange={(e) => setKindId(e.target.value)}>
            {kinds.map((k) => <option key={k.id} value={k.id}>{localizedName(k, locale)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('event.from')} required htmlFor="event-start">
            <Input
              id="event-start"
              type="date"
              value={start}
              onChange={(e) => {
                const v = e.target.value;
                setStart(v);
                if (v && (!end || end < v)) setEnd(v);
              }}
            />
          </Field>
          <Field label={t('event.until')} required htmlFor="event-end">
            <Input id="event-end" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label={t('event.opens')} htmlFor="event-open">
            <Input id="event-open" type="time" value={open} onChange={(e) => setOpen(e.target.value)} />
          </Field>
          <Field label={t('event.closes')} htmlFor="event-close">
            <Input id="event-close" type="time" value={close} onChange={(e) => setClose(e.target.value)} />
          </Field>
        </div>
        <Field label={t('event.placeName')} htmlFor="event-place">
          <Input id="event-place" value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
        </Field>
        <Field label={t('sales.street')} htmlFor="event-street">
          <Input id="event-street" value={street} onChange={(e) => setStreet(e.target.value)} />
        </Field>
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field label={t('event.postalCode')} htmlFor="event-postal">
            <Input id="event-postal" value={postal} onChange={(e) => setPostal(e.target.value)} />
          </Field>
          <Field label={t('event.city')} htmlFor="event-city">
            <Input id="event-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
        </div>
        <Field label={t('event.customer')} hint={t('event.customerHint')} htmlFor="event-customer">
          <Combobox
            id="event-customer"
            items={choices.customers}
            value={customerId}
            onChange={setCustomerId}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => c.name}
          />
        </Field>
        <Field label={t('event.owner')} hint={t('event.ownerHint')} htmlFor="event-owner">
          <Select id="event-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">—</option>
            {choices.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label={t('event.description')} htmlFor="event-description">
          <NoteTextarea id="event-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
