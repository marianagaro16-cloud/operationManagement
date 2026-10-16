'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, ChevronRight, Copy, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { copyEventMaterial, copyStandardMaterial, removeMaterial, saveMaterial, tickMaterial } from '@/server/event-actions';
import type { EventMaterial, EventRow, EventShift, PastMaterial, PastMaterialEvent, StaffCandidate } from '@/types/events';
import { useEventLabels } from './event-parts';

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
const keyOf = (m: Pick<EventMaterial, 'bringer_profile' | 'bringer_worker'>) =>
  m.bringer_profile ? `profile:${m.bringer_profile}` : m.bringer_worker ? `worker:${m.bringer_worker}` : '';

/**
 * What the stand needs that is not for sale — chairs, terminal, flyers. Each
 * thing is ticked when packed, and again when it came back. The day before,
 * the responsible person is told what is not packed yet.
 */
export function EventMaterials({
  event,
  materials,
  shifts,
  staff,
  standard,
  past,
  canEditStandard,
}: {
  event: EventRow;
  materials: EventMaterial[];
  shifts: EventShift[];
  staff: StaffCandidate[];
  /** The names on the kind's standard list. */
  standard: string[];
  /** Material from the other events, to bring back. */
  past: { things: PastMaterial[]; events: PastMaterialEvent[] };
  /** Admin and owners may put a thing on the kind's standard list from here. */
  canEditStandard: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [editing, setEditing] = useState<EventMaterial | 'new' | null>(null);
  const [copying, setCopying] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Sales and Marketing keep it alike.
  const canEdit = event.stage !== 'cancelled';
  const packed = materials.filter((m) => m.packed).length;
  const back = materials.filter((m) => m.came_back).length;
  const norm = (s: string) => s.trim().toLowerCase();
  const missing = standard.filter((s) => !materials.some((m) => norm(m.name) === norm(s))).length;
  // Used at other events and not on this list yet.
  const usedBefore = past.things.filter((p) => !materials.some((m) => norm(m.name) === norm(p.name)));

  // Who can bring something: the event's staff, each once.
  const people = [...new Map(shifts.map((s) => {
    const key = s.profile_id ? `profile:${s.profile_id}` : `worker:${s.hr_worker_id}`;
    return [key, { key, name: s.person_name }] as const;
  })).values()];
  const nameOf = (m: EventMaterial) => {
    const key = keyOf(m);
    if (!key) return null;
    return people.find((p) => p.key === key)?.name ?? staff.find((s) => `${s.kind}:${s.id}` === key)?.name ?? null;
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(labels.error(res.error ?? ''));
      router.refresh();
    });
  };

  const tick = (m: EventMaterial, field: 'packed' | 'came_back', label: string) => {
    const on = m[field];
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        title={label}
        disabled={!canEdit || pending}
        onClick={() => act(() => tickMaterial(m.id, event.id, field, !on))}
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border',
          on ? 'border-done bg-done text-white' : 'border-muted',
          canEdit && !on && 'hover:border-accent hover:bg-accent/10',
        )}
      >
        {on && <Check className="h-3 w-3" aria-hidden />}
      </button>
    );
  };

  return (
    <Card id="materials" className="p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          {t('event.materials')}
          {materials.length > 0 && ` · ${t('event.materialsPacked', { packed, total: materials.length })}`}
        </h2>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('event.addMaterial')}
          </Button>
        )}
      </div>
      {error && <div className="mb-2"><ErrorState message={error} /></div>}

      {materials.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t('event.materialsNone')}</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] text-muted">
              <th className="w-12 py-1 font-medium">{t('event.materialPacked')}</th>
              <th className="py-1 font-medium">{t('event.materialName')}</th>
              <th className="w-14 py-1 font-medium">{t('event.materialBack')}</th>
              {canEdit && <th className="w-16" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {materials.map((m) => {
              const who = nameOf(m);
              return (
                <tr key={m.id} className="align-top">
                  <td className="py-1.5">{tick(m, 'packed', t('event.materialPacked'))}</td>
                  <td className="py-1.5 pr-2">
                    <span className="break-words">
                      {m.quantity !== null && <span className="tabular font-medium">{qty(m.quantity)} × </span>}
                      {m.name}
                    </span>
                    {who && <span className="block text-[12px] text-muted">{t('event.materialBringsShort', { name: who })}</span>}
                  </td>
                  <td className="py-1.5">{tick(m, 'came_back', t('event.materialBack'))}</td>
                  {canEdit && (
                    <td className="py-1 text-right">
                      <span className="inline-flex">
                        <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(m)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={t('common.delete')} disabled={pending} onClick={() => act(() => removeMaterial(m.id, event.id))}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {materials.length > 0 && back > 0 && back < materials.length && (
        <p className="mt-1.5 text-[12px] text-warn">{t('event.materialsNotBack', { count: materials.length - back })}</p>
      )}
      {canEdit && missing > 0 && (
        <Button size="sm" variant="ghost" className="mt-1.5" disabled={pending} onClick={() => act(() => copyStandardMaterial(event.id))}>
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {t('event.copyStandardMaterial', { count: missing })}
        </Button>
      )}
      {canEdit && past.events.length > 0 && (
        <Button size="sm" variant="ghost" className="mt-1.5" disabled={pending} onClick={() => setCopying(true)}>
          <History className="h-3.5 w-3.5" aria-hidden />
          {t('event.copyEventMaterial')}
        </Button>
      )}

      {usedBefore.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-fg"
            aria-expanded={showPast}
            onClick={() => setShowPast((v) => !v)}
          >
            {showPast ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            {t('event.materialsUsedBefore', { count: usedBefore.length })}
          </button>
          {showPast && (
            <ul className="mt-1 divide-y divide-border text-[13px]">
              {usedBefore.map((p) => (
                <li key={p.name} className="flex items-start justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="break-words">
                      {p.quantity !== null && <span className="tabular font-medium">{qty(p.quantity)} × </span>}
                      {p.name}
                    </span>
                    <span className="block text-[12px] text-muted">
                      {t('event.materialLastUsed', { event: p.event_name, date: formatDate(p.event_date, 'medium') })}
                    </span>
                  </span>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => act(() => saveMaterial({ event_id: event.id, name: p.name, quantity: p.quantity }))}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      {t('event.materialAdd')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <MaterialDialog
          event={event}
          material={editing === 'new' ? null : editing}
          people={people}
          past={past.things}
          standard={canEditStandard ? standard : null}
          onClose={() => setEditing(null)}
        />
      )}
      {copying && <CopyDialog event={event} events={past.events} onClose={() => setCopying(false)} />}
    </Card>
  );
}

/** Another event's list onto this one; what is already here stays as it is. */
function CopyDialog({ event, events, onClose }: { event: EventRow; events: PastMaterialEvent[]; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [from, setFrom] = useState(events[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!from) return;
    setError(null);
    startTransition(async () => {
      const res = await copyEventMaterial(event.id, from);
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('event.copyEventMaterial')}
      description={t('event.copyEventMaterialHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!from}>{t('event.copyEventMaterialGo')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('event.copyEventMaterialFrom')} htmlFor="event-material-from">
          <Select id="event-material-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {formatDate(e.start_date, 'medium')} · {t('event.materialsCount', { count: e.count })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function MaterialDialog({
  event,
  material,
  people,
  past,
  standard,
  onClose,
}: {
  event: EventRow;
  material: EventMaterial | null;
  people: { key: string; name: string }[];
  /** Things used at other events, offered while typing. */
  past: PastMaterial[];
  /** The kind's standard list, when the viewer may add to it; null otherwise. */
  standard: string[] | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [name, setName] = useState(material?.name ?? '');
  const [amount, setAmount] = useState(material?.quantity?.toString() ?? '');
  const [bringer, setBringer] = useState(material ? keyOf(material) : '');
  const [keep, setKeep] = useState(false);
  const norm = (s: string) => s.trim().toLowerCase();
  const offerStandard = standard !== null && !!name.trim() && !standard.some((s) => norm(s) === norm(name));

  // Picking a thing used before brings its last quantity, unless one is typed already.
  function pickName(value: string) {
    setName(value);
    const hit = past.find((p) => norm(p.name) === norm(value));
    if (hit && hit.quantity !== null && amount.trim() === '') setAmount(String(hit.quantity));
  }
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const number = amount.trim() === '' ? null : Number(amount.replace(',', '.'));
  const ready = !!name.trim() && (number === null || (Number.isFinite(number) && number > 0));
  // Someone who brings it but no longer has a shift stays choosable.
  const choices = bringer && !people.some((p) => p.key === bringer) ? [...people, { key: bringer, name: '—' }] : people;

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const [kind, id] = bringer.split(':') as ['profile' | 'worker', string];
      const res = await saveMaterial(
        { event_id: event.id, name, quantity: number, bringer: bringer ? { kind, id } : null, standard: offerStandard && keep },
        material?.id,
      );
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={material ? t('event.editMaterial') : t('event.addMaterial')}
      description={t('event.materialHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('event.materialName')} required htmlFor="event-material-name">
          <Input
            id="event-material-name"
            list="event-material-past"
            value={name}
            onChange={(e) => pickName(e.target.value)}
            placeholder={t('event.materialPlaceholder')}
            autoComplete="off"
            autoFocus
          />
          <datalist id="event-material-past">
            {past.map((p) => <option key={p.name} value={p.name} />)}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('event.materialQuantity')} htmlFor="event-material-qty">
            <Input id="event-material-qty" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t('event.materialBrings')} htmlFor="event-material-who" hint={people.length === 0 ? t('event.materialNoStaff') : undefined}>
            <Select id="event-material-who" value={bringer} onChange={(e) => setBringer(e.target.value)} disabled={choices.length === 0}>
              <option value="">—</option>
              {choices.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        {offerStandard && (
          <Checkbox
            label={t('event.materialKeepStandard')}
            hint={t('event.materialKeepStandardHint')}
            checked={keep}
            onChange={(e) => setKeep(e.target.checked)}
          />
        )}
      </div>
    </Dialog>
  );
}
