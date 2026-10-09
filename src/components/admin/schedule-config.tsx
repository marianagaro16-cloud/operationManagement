'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { Hatch, kindFill } from '@/components/schedule/schedule-sheet';
import { useScheduleErrors } from '@/components/schedule/schedule-view';
import { saveScheduleKind, saveSchedulePerson, saveScheduleProduct } from '@/server/schedule-actions';
import type { ScheduleKind, SchedulePerson, ScheduleProduct } from '@/types/schedule';

type Editing =
  | { list: 'person'; row: SchedulePerson | null; external: boolean }
  | { list: 'kind'; row: ScheduleKind | null }
  | { list: 'product'; row: ScheduleProduct | null };

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

/** The lists behind the schedule: who is on it, the kinds of block, the products of a day. */
export function ScheduleConfig({
  people,
  kinds,
  products,
  workers,
}: {
  people: SchedulePerson[];
  kinds: ScheduleKind[];
  products: ScheduleProduct[];
  /** Worker files not on the schedule yet. */
  workers: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<Editing | null>(null);

  const heading = (title: string, hint: string | null, actions: React.ReactNode) => (
    <div className="mb-1.5 flex items-end justify-between gap-3 px-0.5">
      <div>
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {hint && <p className="text-[12px] text-muted">{hint}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5">{actions}</div>
    </div>
  );
  const add = (label: string, onClick: () => void, disabled = false) => (
    <Button size="sm" variant="secondary" onClick={onClick} disabled={disabled}>
      <Plus className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );
  const edit = (onClick: () => void) => (
    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('common.edit')} onClick={onClick}>
      <Pencil className="h-3.5 w-3.5" aria-hidden />
    </Button>
  );

  return (
    <>
      <PageHeader title={t('schedule.navLabel')} subtitle={t('schedule.subtitle')} />

      <section className="mb-6">
        {heading(
          t('schedule.people'),
          t('schedule.peopleHint'),
          <>
            {add(t('schedule.addWorker'), () => setEditing({ list: 'person', row: null, external: false }), workers.length === 0)}
            {add(t('schedule.addExternal'), () => setEditing({ list: 'person', row: null, external: true }))}
          </>,
        )}
        <Card className="divide-y divide-border">
          {people.map((p) => (
            <div key={p.id} className={cn('flex items-center gap-3 px-3.5 py-2', !p.is_active && 'opacity-55')}>
              <span className="w-6 text-[12px] tabular text-muted">{p.sort_order}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13.5px] font-medium">{p.name}</span>
                  {!p.worker_id && <Badge tone="neutral">{t('schedule.external')}</Badge>}
                  {p.is_lead && <Badge tone="accent">{t('schedule.lead')}</Badge>}
                  {p.in_sunday_rotation && <Badge tone="warn">{t('schedule.rotationIn')} {p.sunday_order}</Badge>}
                </div>
                <p className="text-[12px] text-muted">
                  {[
                    p.percent != null && `${p.percent}%`,
                    p.min_hours != null && `${t('schedule.minHours')} ${p.min_hours}`,
                    p.max_hours != null && `${t('schedule.maxHours')} ${p.max_hours}`,
                  ].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              {edit(() => setEditing({ list: 'person', row: p, external: !p.worker_id }))}
            </div>
          ))}
        </Card>
      </section>

      <section className="mb-6">
        {heading(t('schedule.kinds'), t('schedule.kindsHint'), add(t('schedule.add'), () => setEditing({ list: 'kind', row: null })))}
        <Card className="divide-y divide-border">
          {kinds.map((k) => (
            <div key={k.id} className={cn('flex items-center gap-3 px-3.5 py-2', !k.is_active && 'opacity-55')}>
              <span className="block h-5 w-10 shrink-0 rounded-sm border border-border" style={kindFill(k)}>
                <Hatch kind={k} />
              </span>
              <span className="min-w-0 flex-1 text-[13.5px] font-medium">{k.name}</span>
              {!k.counts_hours && <Badge tone="neutral">0 h</Badge>}
              {edit(() => setEditing({ list: 'kind', row: k }))}
            </div>
          ))}
        </Card>
      </section>

      <section>
        {heading(t('schedule.productsList'), null, add(t('schedule.add'), () => setEditing({ list: 'product', row: null })))}
        <Card className="divide-y divide-border">
          {products.map((p) => (
            <div key={p.id} className={cn('flex items-center gap-3 px-3.5 py-2', !p.is_active && 'opacity-55')}>
              <span className="min-w-0 flex-1 text-[13.5px] font-medium">{p.name}</span>
              {p.people_needed != null && <span className="text-[12px] text-muted">{t('schedule.peopleNeededShort', { count: p.people_needed })}</span>}
              {edit(() => setEditing({ list: 'product', row: p }))}
            </div>
          ))}
        </Card>
      </section>

      {editing?.list === 'person' && <PersonDialog row={editing.row} external={editing.external} workers={workers} nextOrder={(people.at(-1)?.sort_order ?? 0) + 10} onClose={() => setEditing(null)} />}
      {editing?.list === 'kind' && <KindDialog row={editing.row} nextOrder={(kinds.at(-1)?.sort_order ?? 0) + 10} onClose={() => setEditing(null)} />}
      {editing?.list === 'product' && <ProductDialog row={editing.row} nextOrder={(products.at(-1)?.sort_order ?? 0) + 10} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Shared by the three dialogs: run the save, show its error, close and refresh. */
function useSave(onClose: () => void) {
  const router = useRouter();
  const errorText = useScheduleErrors();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(errorText(res.error ?? ''));
      onClose();
      router.refresh();
    });
  };
  return { error, pending, save };
}

function Footer({ onClose, onSave, pending, disabled }: { onClose: () => void; onSave: () => void; pending: boolean; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
      <Button variant="primary" onClick={onSave} loading={pending} disabled={disabled}>{t('common.save')}</Button>
    </>
  );
}

function PersonDialog({
  row,
  external,
  workers,
  nextOrder,
  onClose,
}: {
  row: SchedulePerson | null;
  external: boolean;
  workers: { id: string; name: string }[];
  nextOrder: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { error, pending, save } = useSave(onClose);
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? '');
  const [externalName, setExternalName] = useState(row?.external_name ?? '');
  const [label, setLabel] = useState(row?.label ?? '');
  const [order, setOrder] = useState(String(row?.sort_order ?? nextOrder));
  const [percent, setPercent] = useState(row?.percent?.toString() ?? '');
  const [min, setMin] = useState(row?.min_hours?.toString() ?? '');
  const [max, setMax] = useState(row?.max_hours?.toString() ?? '');
  const [lead, setLead] = useState(row?.is_lead ?? false);
  const [rotation, setRotation] = useState(row?.in_sunday_rotation ?? false);
  const [sundayOrder, setSundayOrder] = useState(String(row?.sunday_order ?? 0));
  const [active, setActive] = useState(row?.is_active ?? true);
  const ready = external ? !!externalName.trim() : !!row || !!workerId;

  const submit = () =>
    save(() =>
      saveSchedulePerson(
        {
          worker_id: !row && !external ? workerId : null,
          external_name: external ? externalName : null,
          label,
          sort_order: Number(order) || 0,
          percent: num(percent),
          min_hours: num(min),
          max_hours: num(max),
          is_lead: lead,
          in_sunday_rotation: rotation,
          sunday_order: Number(sundayOrder) || 0,
          is_active: active,
        },
        row?.id,
      ),
    );

  return (
    <Dialog open onClose={onClose} title={row ? row.name : external ? t('schedule.addExternal') : t('schedule.addWorker')} className="max-w-lg" footer={<Footer onClose={onClose} onSave={submit} pending={pending} disabled={!ready} />}>
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {external ? (
          <Field label={t('schedule.name')} required htmlFor="sp-external">
            <Input id="sp-external" value={externalName} maxLength={80} onChange={(e) => setExternalName(e.target.value)} />
          </Field>
        ) : !row ? (
          <Field label={t('schedule.worker')} required htmlFor="sp-worker">
            <Select id="sp-worker" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label={t('schedule.label')} htmlFor="sp-label">
            <Input id="sp-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label={t('schedule.order')} htmlFor="sp-order">
            <Input id="sp-order" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('schedule.percent')} htmlFor="sp-percent">
            <Input id="sp-percent" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </Field>
          <Field label={t('schedule.minHours')} htmlFor="sp-min">
            <Input id="sp-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label={t('schedule.maxHours')} htmlFor="sp-max">
            <Input id="sp-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
          </Field>
        </div>
        <Checkbox label={t('schedule.lead')} checked={lead} onChange={(e) => setLead(e.target.checked)} />
        <div className="grid grid-cols-[1fr_6rem] items-end gap-3">
          <Checkbox label={t('schedule.rotationIn')} checked={rotation} onChange={(e) => setRotation(e.target.checked)} />
          {rotation && (
            <Field label={t('schedule.order')} htmlFor="sp-sunday-order">
              <Input id="sp-sunday-order" inputMode="numeric" value={sundayOrder} onChange={(e) => setSundayOrder(e.target.value)} />
            </Field>
          )}
        </div>
        {row && <Checkbox label={t('schedule.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />}
      </div>
    </Dialog>
  );
}

function KindDialog({ row, nextOrder, onClose }: { row: ScheduleKind | null; nextOrder: number; onClose: () => void }) {
  const { t } = useI18n();
  const { error, pending, save } = useSave(onClose);
  const [name, setName] = useState(row?.name ?? '');
  const [color, setColor] = useState(row?.color ?? '#9EC5FE');
  const [hatched, setHatched] = useState(row?.hatched ?? false);
  const [counts, setCounts] = useState(row?.counts_hours ?? true);
  const [active, setActive] = useState(row?.is_active ?? true);
  const system = !!row?.system_key;
  const submit = () => save(() => saveScheduleKind({ name, color, hatched, counts_hours: counts, sort_order: row?.sort_order ?? nextOrder, is_active: active }, row?.id));

  return (
    <Dialog open onClose={onClose} title={row ? row.name : t('schedule.kinds')} className="max-w-md" footer={<Footer onClose={onClose} onSave={submit} pending={pending} disabled={!name.trim()} />}>
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('schedule.name')} required htmlFor="sk-name">
          <Input id="sk-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex items-end gap-3">
          <Field label={t('schedule.color')} htmlFor="sk-color">
            <input id="sk-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 cursor-pointer rounded border border-border bg-surface" />
          </Field>
          <span className="mb-0.5 block h-8 w-24 rounded-sm border border-border" style={kindFill({ color, hatched })}>
            <Hatch kind={{ color, hatched }} />
          </span>
        </div>
        <Checkbox label={t('schedule.hatched')} checked={hatched} onChange={(e) => setHatched(e.target.checked)} />
        {!system && <Checkbox label={t('schedule.countsHours')} checked={counts} onChange={(e) => setCounts(e.target.checked)} />}
        {row && !system && <Checkbox label={t('schedule.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />}
      </div>
    </Dialog>
  );
}

function ProductDialog({ row, nextOrder, onClose }: { row: ScheduleProduct | null; nextOrder: number; onClose: () => void }) {
  const { t } = useI18n();
  const { error, pending, save } = useSave(onClose);
  const [name, setName] = useState(row?.name ?? '');
  const [needed, setNeeded] = useState(row?.people_needed?.toString() ?? '');
  const [active, setActive] = useState(row?.is_active ?? true);
  const submit = () => save(() => saveScheduleProduct({ name, people_needed: num(needed), sort_order: row?.sort_order ?? nextOrder, is_active: active }, row?.id));

  return (
    <Dialog open onClose={onClose} title={row ? row.name : t('schedule.productsList')} className="max-w-md" footer={<Footer onClose={onClose} onSave={submit} pending={pending} disabled={!name.trim()} />}>
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('schedule.name')} required htmlFor="spr-name">
          <Input id="spr-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('schedule.peopleNeeded')} hint={t('schedule.peopleNeededHint')} htmlFor="spr-needed">
          <Input id="spr-needed" inputMode="decimal" value={needed} onChange={(e) => setNeeded(e.target.value)} className="w-24" />
        </Field>
        {row && <Checkbox label={t('schedule.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />}
      </div>
    </Dialog>
  );
}
