'use client';

import { useI18n } from '@/i18n';
import { Field, Input, Select } from '@/components/ui/primitives';
import { useKinds } from './activity-kind';
import type { PlanInput } from '@/server/sales-actions';
import { addMinutes } from '@/domain/sales/times';
import type { ActivityKind, AppointmentPlace } from '@/types/sales';

/** A plan being filled in; every field a string, as the inputs hold them. */
export interface PlanDraft {
  kind_id: string;
  activity_date: string;
  activity_time: string;
  /** Until when; filled in from the kind's usual length when a start is set. */
  activity_end: string;
  title: string;
  place: AppointmentPlace | '';
  place_detail: string;
}

export const emptyPlan = (date: string, kinds: ActivityKind[]): PlanDraft => ({
  kind_id: kinds.find((k) => k.is_active)?.id ?? '',
  activity_date: date,
  activity_time: '',
  activity_end: '',
  title: '',
  place: '',
  place_detail: '',
});

/** The draft as the server takes it; null when it is not complete. */
export function toPlanInput(d: PlanDraft, kinds: ActivityKind[], needsTitle = false): PlanInput | null {
  if (!d.kind_id || !d.activity_date) return null;
  if (needsTitle && !d.title.trim()) return null;
  const appointment = kinds.find((k) => k.id === d.kind_id)?.behavior === 'appointment';
  return {
    kind_id: d.kind_id,
    activity_date: d.activity_date,
    activity_time: d.activity_time || null,
    activity_end: d.activity_time && d.activity_end && d.activity_end > d.activity_time ? d.activity_end : null,
    title: d.title.trim() || null,
    place: appointment && d.place ? d.place : null,
    place_detail: appointment && d.place_detail.trim() ? d.place_detail.trim() : null,
  };
}

/**
 * What, when, and — for an appointment — where. Shared by every place a
 * sales activity is planned: the planning, a result's "next", a note, a
 * prospect's first activity.
 */
export function PlanFields({
  draft,
  onChange,
  kinds,
  today,
  idPrefix,
  titleLabel,
  titleRequired = false,
}: {
  draft: PlanDraft;
  onChange: (d: PlanDraft) => void;
  kinds: ActivityKind[];
  today: string;
  idPrefix: string;
  titleLabel?: string;
  titleRequired?: boolean;
}) {
  const { t } = useI18n();
  const k = useKinds(kinds);
  const set = (patch: Partial<PlanDraft>) => onChange({ ...draft, ...patch });
  // The end follows the start by the kind's usual length, until someone sets it by hand.
  const usual = (kindId: string) => k.get(kindId)?.default_minutes ?? 30;
  const endFor = (start: string, kindId: string) => (start ? addMinutes(start, usual(kindId)) : '');
  const endIsUsual = !draft.activity_end || draft.activity_end === endFor(draft.activity_time, draft.kind_id);
  const appointment = k.get(draft.kind_id)?.behavior === 'appointment';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto]">
        <Field label={t('sales.planKind')} htmlFor={`${idPrefix}-kind`}>
          <Select
            id={`${idPrefix}-kind`}
            value={draft.kind_id}
            onChange={(e) =>
              set({ kind_id: e.target.value, ...(endIsUsual ? { activity_end: endFor(draft.activity_time, e.target.value) } : {}) })
            }
          >
            {k.choices(draft.kind_id).map((kind) => (
              <option key={kind.id} value={kind.id}>{k.name(kind.id)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('sales.planDate')} htmlFor={`${idPrefix}-date`}>
          <Input id={`${idPrefix}-date`} type="date" min={today} value={draft.activity_date} onChange={(e) => set({ activity_date: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('sales.planTime')} htmlFor={`${idPrefix}-time`}>
          <Input
            id={`${idPrefix}-time`}
            type="time"
            value={draft.activity_time}
            onChange={(e) =>
              set({
                activity_time: e.target.value,
                ...(endIsUsual || !e.target.value ? { activity_end: endFor(e.target.value, draft.kind_id) } : {}),
              })
            }
          />
        </Field>
        <Field
          label={t('sales.planEnd')}
          htmlFor={`${idPrefix}-end`}
          error={draft.activity_time && draft.activity_end && draft.activity_end <= draft.activity_time ? t('sales.planEndBefore') : undefined}
        >
          <Input
            id={`${idPrefix}-end`}
            type="time"
            value={draft.activity_end}
            disabled={!draft.activity_time}
            onChange={(e) => set({ activity_end: e.target.value })}
          />
        </Field>
      </div>
      <Field label={titleLabel ?? t('sales.planTitle')} htmlFor={`${idPrefix}-title`} required={titleRequired}>
        <Input
          id={`${idPrefix}-title`}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={t('sales.planTitlePlaceholder')}
        />
      </Field>
      {appointment && (
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Field label={t('sales.planPlace')} htmlFor={`${idPrefix}-place`}>
            <Select id={`${idPrefix}-place`} value={draft.place} onChange={(e) => set({ place: e.target.value as PlanDraft['place'] })}>
              <option value="">—</option>
              <option value="theirs">{t('sales.placeTheirs')}</option>
              <option value="office">{t('sales.placeOffice')}</option>
              <option value="online">{t('sales.placeOnline')}</option>
              <option value="other">{t('sales.placeOther')}</option>
            </Select>
          </Field>
          {(draft.place === 'online' || draft.place === 'other') && (
            <Field label={draft.place === 'online' ? t('sales.placeLink') : t('sales.placeAddress')} htmlFor={`${idPrefix}-where`}>
              <Input id={`${idPrefix}-where`} value={draft.place_detail} onChange={(e) => set({ place_detail: e.target.value })} />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Who else from the company takes part. It shows in their Planning too, and
 * they are told; the organiser is not offered — it is theirs already.
 */
export function ParticipantsField({
  people,
  organiserId,
  value,
  onChange,
}: {
  people: { id: string; name: string }[];
  organiserId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const others = people.filter((p) => p.id !== organiserId);
  if (others.length === 0) return null;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Field label={t('sales.planWith')} hint={t('sales.planWithHint')}>
      <div className="flex flex-wrap gap-1.5">
        {others.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p.id)}
              className={
                on
                  ? 'rounded-full border border-accent bg-accent/10 px-2.5 py-1 text-[12.5px] font-medium text-accent'
                  : 'rounded-full border border-border px-2.5 py-1 text-[12.5px] text-muted hover:text-fg'
              }
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </Field>
  );
}
