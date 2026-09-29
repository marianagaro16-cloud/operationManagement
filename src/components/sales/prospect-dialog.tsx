'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { saveProspect, type ProspectInput } from '@/server/sales-actions';
import { OPEN_STAGES, type ActivityKind, type Prospect, type ProspectListEntry } from '@/types/sales';
import { useProspectError, useProspectLabels } from './prospect-parts';
import { PlanFields, emptyPlan, toPlanInput, type PlanDraft } from './plan-fields';

export interface ProspectChoices {
  people: { id: string; name: string }[];
  customerTypes: { id: string; name: string }[];
  /** Admin's lists, inactive entries included so an old choice still reads. */
  sources: ProspectListEntry[];
  lostReasons: ProspectListEntry[];
  /** The kinds of activity, for planning the first one. */
  kinds: ActivityKind[];
  /** The viewer, responsible by default when they are in sales. */
  viewerId: string;
}

/**
 * Create a prospect — with its first planned activity, since every open
 * prospect has something planned — or change an open one's details and stage.
 */
export function ProspectDialog({
  prospect,
  choices,
  today,
  onClose,
}: {
  prospect: Prospect | null;
  choices: ProspectChoices;
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useProspectLabels();
  const errorText = useProspectError();
  const defaultOwner = choices.people.some((p) => p.id === choices.viewerId) ? choices.viewerId : choices.people[0]?.id ?? '';
  const [form, setForm] = useState<ProspectInput>(
    prospect
      ? {
          company_name: prospect.company_name,
          contact_name: prospect.contact_name,
          phone: prospect.phone,
          email: prospect.email,
          street: prospect.street,
          postal_code: prospect.postal_code,
          city: prospect.city,
          customer_type_id: prospect.customer_type_id,
          source_id: prospect.source_id,
          interest: prospect.interest,
          weekly_volume: prospect.weekly_volume,
          stage: prospect.stage as ProspectInput['stage'],
          owner_id: prospect.owner_id ?? defaultOwner,
        }
      : { company_name: '', stage: 'new', owner_id: defaultOwner },
  );
  const [first, setFirst] = useState<PlanDraft>(emptyPlan(today, choices.kinds));
  const firstPlan = prospect ? null : toPlanInput(first, choices.kinds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<ProspectInput>) => setForm((f) => ({ ...f, ...patch }));
  const text = (key: keyof ProspectInput) => (form[key] as string | null | undefined) ?? '';
  const ready = form.company_name.trim() && form.owner_id && (prospect || firstPlan);

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await saveProspect(form, prospect?.id, firstPlan ?? undefined);
      if (!res.ok) return setError(errorText(res.error));
      onClose();
      if (!prospect) router.push(`/sales/prospects/${res.data.id}`);
      else router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={prospect ? t('sales.editProspect') : t('sales.newProspect')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}

        <Field label={t('sales.company')} required htmlFor="p-company">
          <Input id="p-company" value={form.company_name} onChange={(e) => set({ company_name: e.target.value })} autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.stage')} htmlFor="p-stage">
            <Select id="p-stage" value={form.stage} onChange={(e) => set({ stage: e.target.value as ProspectInput['stage'] })}>
              {OPEN_STAGES.map((s) => <option key={s} value={s}>{labels.stage(s)}</option>)}
            </Select>
          </Field>
          <Field label={t('sales.owner')} htmlFor="p-owner" required>
            <Select id="p-owner" value={form.owner_id} onChange={(e) => set({ owner_id: e.target.value })}>
              {choices.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>

        {!prospect && (
          <div className="rounded-lg border border-accent/25 bg-accent/[0.04] p-3">
            <p className="mb-2 text-[12.5px] font-medium">{t('sales.firstActivity')}</p>
            <PlanFields draft={first} onChange={setFirst} kinds={choices.kinds} today={today} idPrefix="first" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.contactName')} htmlFor="p-contact">
            <Input id="p-contact" value={text('contact_name')} onChange={(e) => set({ contact_name: e.target.value })} />
          </Field>
          <Field label={t('sales.phone')} htmlFor="p-phone">
            <Input id="p-phone" type="tel" value={text('phone')} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
        </div>
        <Field label={t('sales.email')} htmlFor="p-email">
          <Input id="p-email" type="email" value={text('email')} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label={t('sales.street')} htmlFor="p-street">
          <Input id="p-street" value={text('street')} onChange={(e) => set({ street: e.target.value })} />
        </Field>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label={t('sales.postalCode')} htmlFor="p-zip">
            <Input id="p-zip" inputMode="numeric" value={text('postal_code')} onChange={(e) => set({ postal_code: e.target.value })} />
          </Field>
          <Field label={t('sales.city')} htmlFor="p-city">
            <Input id="p-city" value={text('city')} onChange={(e) => set({ city: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.businessType')} htmlFor="p-type">
            <Select id="p-type" value={form.customer_type_id ?? ''} onChange={(e) => set({ customer_type_id: e.target.value || null })}>
              <option value="">—</option>
              {choices.customerTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={t('sales.source')} htmlFor="p-source">
            <Select id="p-source" value={form.source_id ?? ''} onChange={(e) => set({ source_id: e.target.value || null })}>
              <option value="">—</option>
              {choices.sources
                .filter((s) => s.is_active || s.id === form.source_id)
                .map((s) => <option key={s.id} value={s.id}>{labels.entry(choices.sources, s.id)}</option>)}
            </Select>
          </Field>
        </div>

        <Field label={t('sales.interest')} htmlFor="p-interest">
          <NoteTextarea id="p-interest" rows={2} value={text('interest')} onChange={(e) => set({ interest: e.target.value })} />
        </Field>
        <Field label={t('sales.weeklyVolume')} htmlFor="p-volume">
          <Input
            id="p-volume"
            placeholder={t('sales.weeklyVolumePlaceholder')}
            value={text('weekly_volume')}
            onChange={(e) => set({ weekly_volume: e.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}
