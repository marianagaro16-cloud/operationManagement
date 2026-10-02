'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mail, Pencil, Phone, Plus, Search, Wrench } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PageHeader } from '@/components/shell/app-shell';
import { filterByQuery } from '@/lib/search';
import { saveEquipment, setEquipmentActive } from '@/server/equipment-actions';
import type { Equipment, EquipmentDay, EquipmentRow } from '@/server/equipment';
import type { Repair } from '@/server/repairs';
import { RepairRow } from './repairs';

/** The company's machines and installations, with their last and next maintenance. */
export function EquipmentList({ list, canManage, today }: { list: EquipmentRow[]; canManage: boolean; today: string }) {
  const { t, formatDate } = useI18n();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const inactive = list.filter((e) => !e.is_active).length;
  const shown = filterByQuery(
    list.filter((e) => showInactive || e.is_active),
    query,
    (e) => [e.name, e.location ?? '', e.brand ?? '', e.model ?? '', e.serial_number ?? ''].join(' '),
  );

  return (
    <>
      <PageHeader
        title={t('equipment.title')}
        subtitle={t('equipment.subtitle')}
        action={
          canManage && (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('equipment.new')}
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('equipment.search')} aria-label={t('equipment.search')} className="pl-9" />
        </div>
        {inactive > 0 && (
          <Checkbox label={t('equipment.showInactive', { count: inactive })} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState title={list.length === 0 ? t('equipment.none') : t('equipment.noneFound')} body={list.length === 0 && canManage ? t('equipment.noneBody') : undefined} />
      ) : (
        <Card className="divide-y divide-border">
          {shown.map((e) => (
            <Link key={e.id} href={`/maintenance/equipment/${e.id}`} className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-surface-2">
              <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={cn('text-[13.5px] font-medium', !e.is_active && 'text-muted line-through')}>{e.name}</p>
                <p className="text-[12px] text-muted">{[e.location, [e.brand, e.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              <div className="shrink-0 text-right text-[11.5px]">
                {e.next_planned && (
                  <p className={cn('font-medium', e.next_planned === today ? 'text-accent' : 'text-fg')}>
                    {t('equipment.next', { date: formatDate(e.next_planned, 'short') })}
                  </p>
                )}
                <p className="text-muted">{e.last_done ? t('equipment.last', { date: formatDate(e.last_done, 'short') }) : t('equipment.never')}</p>
              </div>
            </Link>
          ))}
        </Card>
      )}
      {creating && <EquipmentDialog onClose={() => setCreating(false)} />}
    </>
  );
}

/** One machine: its details, who services it, its activities, and what was planned and done. */
export function EquipmentView({
  equipment,
  activities,
  days,
  canManage,
  today,
  repairs = [],
}: {
  /** Repair reports about this machine, newest first. */
  repairs?: Repair[];
  equipment: Equipment;
  activities: { id: string; title: string; is_active: boolean }[];
  days: EquipmentDay[];
  canManage: boolean;
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const ahead = days.filter((d) => d.status === 'pending' && d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const history = days.filter((d) => !(d.status === 'pending' && d.date >= today));
  const statusLabel = (s: string) =>
    s === 'completed' ? t('equipment.done') : s === 'skipped' ? t('equipment.skipped') : t('equipment.notDone');

  const details: [string, string | null][] = [
    [t('equipment.location'), equipment.location],
    [t('equipment.brand'), equipment.brand],
    [t('equipment.model'), equipment.model],
    [t('equipment.serial'), equipment.serial_number],
  ];

  return (
    <>
      <Link href="/maintenance/equipment" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('equipment.title')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold leading-tight">{equipment.name}</h1>
            {!equipment.is_active && <Badge tone="neutral" className="mt-1">{t('equipment.outOfService')}</Badge>}
          </div>
          {canManage && (
            <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[9rem_1fr]">
          {details.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {(equipment.service_contact || equipment.service_phone || equipment.service_email) && (
          <div className="mt-3 rounded-lg bg-surface-2/70 px-3 py-2 text-[13px]">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('equipment.service')}</p>
            {equipment.service_contact && <p className="font-medium">{equipment.service_contact}</p>}
            <div className="flex flex-wrap gap-x-4">
              {equipment.service_phone && (
                <a href={`tel:${equipment.service_phone}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                  <Phone className="h-3.5 w-3.5" aria-hidden />
                  {equipment.service_phone}
                </a>
              )}
              {equipment.service_email && (
                <a href={`mailto:${equipment.service_email}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  {equipment.service_email}
                </a>
              )}
            </div>
          </div>
        )}
        {equipment.notes && <NoteText text={equipment.notes} className="mt-3 text-[13px]" />}
        {canManage && (
          <div className="mt-3">
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { await setEquipmentActive(equipment.id, !equipment.is_active); router.refresh(); })}>
              {equipment.is_active ? t('equipment.retire') : t('equipment.reactivate')}
            </Button>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card className="p-3">
            <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('equipment.activities')}</h2>
            {activities.length === 0 ? (
              <p className="text-[12.5px] text-muted">{t('equipment.noActivities')}</p>
            ) : (
              <ul className="space-y-1 text-[13px]">
                {activities.map((a) => (
                  <li key={a.id} className={cn(!a.is_active && 'text-muted line-through')}>
                    {canManage ? <Link href={`/admin/tasks?edit=${a.id}`} className="hover:text-accent">{a.title}</Link> : a.title}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11.5px] text-subtle">{t('equipment.activitiesHint')}</p>
          </Card>
          <Card className="p-3">
            <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('equipment.planned')}</h2>
            {ahead.length === 0 ? (
              <p className="text-[12.5px] text-muted">{t('equipment.nothingPlanned')}</p>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {ahead.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-24 shrink-0 tabular text-muted">{formatDate(d.date, 'short')}</span>
                    <span className="min-w-0 flex-1">{d.title}</span>
                    <span className="shrink-0 text-[12px] text-muted">{d.assignee_name ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-4">
        {repairs.length > 0 && (
          <Card className="overflow-hidden">
            <h2 className="px-3 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('repair.title')}</h2>
            <div className="divide-y divide-border">{repairs.map((r) => <RepairRow key={r.id} r={r} showReporter />)}</div>
          </Card>
        )}
        <Card className="p-3">
          <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('equipment.history')}</h2>
          {history.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t('equipment.noHistory')}</p>
          ) : (
            <ul className="divide-y divide-border text-[13px]">
              {history.map((d) => (
                <li key={d.id} className="flex items-center gap-2 py-1.5">
                  <span className="w-24 shrink-0 tabular text-muted">{formatDate(d.date, 'short')}</span>
                  <span className="min-w-0 flex-1">
                    {d.title}
                    {d.assignee_name && <span className="text-muted"> · {d.assignee_name}</span>}
                  </span>
                  <Badge tone={d.status === 'completed' ? 'done' : d.status === 'skipped' ? 'neutral' : 'late'}>{statusLabel(d.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        </div>
      </div>

      {editing && <EquipmentDialog equipment={equipment} onClose={() => setEditing(false)} />}
    </>
  );
}

function EquipmentDialog({ equipment, onClose }: { equipment?: Equipment; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState({
    name: equipment?.name ?? '',
    location: equipment?.location ?? '',
    brand: equipment?.brand ?? '',
    model: equipment?.model ?? '',
    serial_number: equipment?.serial_number ?? '',
    service_contact: equipment?.service_contact ?? '',
    service_phone: equipment?.service_phone ?? '',
    service_email: equipment?.service_email ?? '',
    notes: equipment?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  function submit() {
    if (!form.name.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await saveEquipment(form, equipment?.id);
      if (!res.ok) return setError(res.error === 'name_exists' ? t('equipment.errExists') : res.error === 'not_authorized' ? t('equipment.errNotAuthorized') : t('common.error'));
      onClose();
      if (equipment) router.refresh();
      else router.push(`/maintenance/equipment/${res.data.id}`);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={equipment ? t('equipment.edit') : t('equipment.new')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!form.name.trim()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('equipment.name')} required htmlFor="eq-name">
            <Input id="eq-name" value={form.name} onChange={set('name')} maxLength={120} autoFocus placeholder={t('equipment.namePlaceholder')} />
          </Field>
          <Field label={t('equipment.location')} htmlFor="eq-location">
            <Input id="eq-location" value={form.location} onChange={set('location')} maxLength={120} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label={t('equipment.brand')} htmlFor="eq-brand">
            <Input id="eq-brand" value={form.brand} onChange={set('brand')} maxLength={80} />
          </Field>
          <Field label={t('equipment.model')} htmlFor="eq-model">
            <Input id="eq-model" value={form.model} onChange={set('model')} maxLength={80} />
          </Field>
          <Field label={t('equipment.serial')} htmlFor="eq-serial">
            <Input id="eq-serial" value={form.serial_number} onChange={set('serial_number')} maxLength={80} />
          </Field>
        </div>
        <Field label={t('equipment.service')} hint={t('equipment.serviceHint')}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input aria-label={t('equipment.serviceContact')} placeholder={t('equipment.serviceContact')} value={form.service_contact} onChange={set('service_contact')} maxLength={120} />
            <Input aria-label={t('equipment.phone')} placeholder={t('equipment.phone')} value={form.service_phone} onChange={set('service_phone')} maxLength={40} inputMode="tel" />
            <Input aria-label={t('equipment.email')} placeholder={t('equipment.email')} value={form.service_email} onChange={set('service_email')} maxLength={120} inputMode="email" />
          </div>
        </Field>
        <Field label={t('equipment.notes')} htmlFor="eq-notes">
          <NoteTextarea id="eq-notes" rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} />
        </Field>
      </div>
    </Dialog>
  );
}
