'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarPlus, Check, Pencil, Plus, Siren, Wrench } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PageHeader } from '@/components/shell/app-shell';
import { PeoplePicker } from '@/components/tasks/people-picker';
import type { OneOffPerson } from '@/components/calendar/one-off-dialog';
import { fixRepair, planRepair, reportRepair, setRepairStatus } from '@/server/repair-actions';
import type { Repair, RepairStatus, RepairUrgency } from '@/server/repairs';

type Choice = { id: string; name: string };

const URGENCY_LABEL: Record<RepairUrgency, MessageKey> = {
  normal: 'repair.urgencyNormal',
  urgent: 'repair.urgencyUrgent',
  stops_production: 'repair.urgencyStops',
};
const STATUS_LABEL: Record<RepairStatus, MessageKey> = {
  new: 'repair.statusNew',
  in_progress: 'repair.statusInProgress',
  fixed: 'repair.statusFixed',
  cancelled: 'repair.statusCancelled',
};
const STATUS_TONE: Record<RepairStatus, 'neutral' | 'accent' | 'done' | 'skipped'> = { new: 'neutral', in_progress: 'accent', fixed: 'done', cancelled: 'skipped' };

export function UrgencyBadge({ urgency }: { urgency: RepairUrgency }) {
  const { t } = useI18n();
  if (urgency === 'normal') return null;
  return (
    <Badge tone={urgency === 'stops_production' ? 'late' : 'warn'}>
      <Siren className="mr-0.5 h-3 w-3" aria-hidden />
      {t(URGENCY_LABEL[urgency])}
    </Badge>
  );
}

export function RepairStatusBadge({ status }: { status: RepairStatus }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]}>{t(STATUS_LABEL[status])}</Badge>;
}

/** A report as a row: urgency, what, where, who reported it, status. */
export function RepairRow({ r, showReporter }: { r: Repair; showReporter: boolean }) {
  const { formatDate } = useI18n();
  return (
    <Link href={`/maintenance/repairs/${r.id}`} className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-surface-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
          <UrgencyBadge urgency={r.urgency} />
          {r.title}
        </p>
        <p className="text-[12px] text-muted">
          {[r.equipment_name ?? r.place, showReporter ? r.reporter_name : null, formatDate(r.created_at.slice(0, 10), 'short')].filter(Boolean).join(' · ')}
          {r.planned_on && r.status === 'in_progress' && ` · → ${formatDate(r.planned_on, 'short')}`}
        </p>
      </div>
      <RepairStatusBadge status={r.status} />
    </Link>
  );
}

/** Reports of broken things: one's own — or, for Maintenance, all of them. */
export function RepairList({
  tab,
  repairs,
  equipment,
  isMaintenance,
}: {
  tab: 'open' | 'closed';
  repairs: Repair[];
  equipment: Choice[];
  isMaintenance: boolean;
}) {
  const { t } = useI18n();
  const [reporting, setReporting] = useState(false);
  return (
    <>
      <PageHeader
        title={t('repair.title')}
        subtitle={isMaintenance ? t('repair.subtitleMaintenance') : t('repair.subtitle')}
        action={
          <Button variant="primary" size="sm" onClick={() => setReporting(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('repair.report')}
          </Button>
        }
      />
      <div className="-mt-2 mb-3 flex gap-1 border-b border-border">
        {(['open', 'closed'] as const).map((key) => (
          <Link
            key={key}
            href={key === 'open' ? '/maintenance/repairs' : '/maintenance/repairs?tab=closed'}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {key === 'open' ? t('repair.tabOpen') : t('repair.tabClosed')}
          </Link>
        ))}
      </div>
      {repairs.length === 0 ? (
        <EmptyState title={tab === 'open' ? t('repair.noneOpen') : t('repair.noneClosed')} />
      ) : (
        <Card className="divide-y divide-border">
          {repairs.map((r) => <RepairRow key={r.id} r={r} showReporter={isMaintenance} />)}
        </Card>
      )}
      {reporting && <ReportDialog equipment={equipment} onClose={() => setReporting(false)} />}
    </>
  );
}

function ReportDialog({ repair, equipment, onClose }: { repair?: Repair; equipment: Choice[]; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(repair?.title ?? '');
  const [description, setDescription] = useState(repair?.description ?? '');
  const [equipmentId, setEquipmentId] = useState(repair?.equipment_id ?? '');
  const [place, setPlace] = useState(repair?.place ?? '');
  const [urgency, setUrgency] = useState<RepairUrgency>(repair?.urgency ?? 'normal');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await reportRepair({ title, description, equipment_id: equipmentId || null, place: equipmentId ? null : place, urgency }, repair?.id);
      if (!res.ok) return setError(res.error === 'not_authorized' ? t('repair.errNotAuthorized') : t('common.error'));
      onClose();
      if (repair) router.refresh();
      else router.push(`/maintenance/repairs/${res.data.id}`);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={repair ? t('repair.edit') : t('repair.report')}
      description={repair ? undefined : t('repair.reportHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!title.trim()}>{repair ? t('common.save') : t('repair.send')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t('repair.what')} required htmlFor="rep-title">
          <Input id="rep-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t('repair.whatPlaceholder')} autoFocus />
        </Field>
        <Field label={t('repair.urgency')} htmlFor="rep-urgency">
          <div className="flex flex-wrap gap-1.5">
            {(['normal', 'urgent', 'stops_production'] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={urgency === u}
                onClick={() => setUrgency(u)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12.5px]',
                  urgency === u
                    ? u === 'stops_production' ? 'border-late bg-late/10 font-medium text-late' : u === 'urgent' ? 'border-warn bg-warn/10 font-medium text-warn' : 'border-accent bg-accent/10 font-medium text-accent'
                    : 'border-border text-muted hover:text-fg',
                )}
              >
                {t(URGENCY_LABEL[u])}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('repair.equipment')} htmlFor="rep-equipment">
            <Select id="rep-equipment" value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
              <option value="">{t('repair.otherBuilding')}</option>
              {equipment.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </Select>
          </Field>
          {!equipmentId && (
            <Field label={t('repair.place')} htmlFor="rep-place">
              <Input id="rep-place" value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} placeholder={t('repair.placePlaceholder')} />
            </Field>
          )}
        </div>
        <Field label={t('repair.details')} htmlFor="rep-desc">
          <NoteTextarea id="rep-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
        </Field>
      </div>
    </Dialog>
  );
}

/** One report: what, where, how urgent; planned as a maintenance day, and closed with what was done. */
export function RepairView({
  repair,
  equipment,
  isMaintenance,
  viewerId,
  people,
  today,
}: {
  repair: Repair;
  equipment: Choice[];
  isMaintenance: boolean;
  viewerId: string;
  /** Who a repair can be planned for: Maintenance's people. */
  people: OneOffPerson[];
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mine = repair.reported_by === viewerId;
  const open = repair.status === 'new' || repair.status === 'in_progress';

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error === 'not_authorized' ? t('repair.errNotAuthorized') : t('common.error'));
      router.refresh();
    });
  };

  return (
    <>
      <Link href="/maintenance/repairs" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('repair.title')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold leading-tight">{repair.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              <RepairStatusBadge status={repair.status} />
              <UrgencyBadge urgency={repair.urgency} />
              <span>{t('repair.reportedBy', { name: repair.reporter_name ?? '—', date: formatDate(repair.created_at.slice(0, 10), 'short') })}</span>
            </p>
          </div>
          {mine && repair.status === 'new' && (
            <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[13px]">
          <Wrench className="h-3.5 w-3.5 text-muted" aria-hidden />
          {repair.equipment_id ? (
            <Link href={`/maintenance/equipment/${repair.equipment_id}`} className="hover:text-accent">{repair.equipment_name}</Link>
          ) : (
            repair.place ?? t('repair.otherBuilding')
          )}
        </p>
        {repair.description && <NoteText text={repair.description} className="mt-2 text-[13.5px]" />}
        {repair.planned_on && open && (
          <p className="mt-2 text-[13px]">
            {t('repair.plannedFor', { date: formatDate(repair.planned_on, 'weekday') })}
          </p>
        )}

        {error && <div className="mt-3"><ErrorState message={error} /></div>}

        <div className="mt-3 flex flex-wrap gap-2">
          {isMaintenance && open && !repair.task_id && (
            <Button size="sm" variant="primary" onClick={() => setPlanning(true)} disabled={pending}>
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              {t('repair.plan')}
            </Button>
          )}
          {isMaintenance && open && (
            <Button size="sm" variant="success" onClick={() => setFixing(true)} disabled={pending}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              {t('repair.markFixed')}
            </Button>
          )}
          {isMaintenance && !open && (
            <Button size="sm" variant="ghost" onClick={() => run(() => setRepairStatus(repair.id, 'in_progress'))} disabled={pending}>
              {t('repair.reopen')}
            </Button>
          )}
          {((mine && repair.status === 'new') || (isMaintenance && open)) && (
            <Button size="sm" variant="ghost" onClick={() => window.confirm(t('repair.cancelConfirm')) && run(() => setRepairStatus(repair.id, 'cancelled'))} disabled={pending}>
              {t('repair.cancel')}
            </Button>
          )}
        </div>
      </Card>

      {repair.status === 'fixed' && (
        <Card className="p-3">
          <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('repair.resolution')}</h2>
          {repair.resolution && <NoteText text={repair.resolution} className="text-[13.5px]" />}
          <p className="mt-2 text-[12.5px] text-muted">
            {[
              repair.fixed_by_name && repair.fixed_at && t('repair.fixedBy', { name: repair.fixed_by_name, date: formatDate(repair.fixed_at.slice(0, 10), 'short') }),
              repair.cost !== null && t('repair.costIs', { cost: `CHF ${repair.cost.toFixed(2)}` }),
            ].filter(Boolean).join(' · ')}
          </p>
        </Card>
      )}

      {editing && <ReportDialog repair={repair} equipment={equipment} onClose={() => setEditing(false)} />}
      {planning && <PlanDialog repairId={repair.id} people={people} today={today} viewerId={viewerId} onClose={() => setPlanning(false)} />}
      {fixing && <FixDialog repairId={repair.id} onClose={() => setFixing(false)} />}
    </>
  );
}

function PlanDialog({ repairId, people, today, viewerId, onClose }: { repairId: string; people: OneOffPerson[]; today: string; viewerId: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [who, setWho] = useState<string[]>(people.some((p) => p.id === viewerId) ? [viewerId] : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('repair.plan')}
      description={t('repair.planHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!date}
            onClick={() =>
              startTransition(async () => {
                const res = await planRepair(repairId, date, who);
                if (!res.ok) return setError(t('common.error'));
                onClose();
                router.refresh();
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t('repair.planDay')} required htmlFor="rep-day">
          <Input id="rep-day" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        </Field>
        <Field label={t('repair.planWho')}>
          <PeoplePicker people={people} selected={who} onChange={setWho} />
        </Field>
      </div>
    </Dialog>
  );
}

function FixDialog({ repairId, onClose }: { repairId: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [resolution, setResolution] = useState('');
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amount = cost.trim() === '' ? null : Number(cost.replace(/'/g, '').replace(',', '.'));
  const ready = resolution.trim() !== '' && (amount === null || (Number.isFinite(amount) && amount >= 0));
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('repair.markFixed')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="success"
            loading={pending}
            disabled={!ready}
            onClick={() =>
              startTransition(async () => {
                const res = await fixRepair(repairId, { resolution, cost: amount });
                if (!res.ok) return setError(t('common.error'));
                onClose();
                router.refresh();
              })
            }
          >
            {t('repair.markFixed')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t('repair.whatWasDone')} required htmlFor="rep-res">
          <NoteTextarea id="rep-res" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={4000} autoFocus />
        </Field>
        <Field label={t('repair.cost')} hint={t('repair.costHint')} htmlFor="rep-cost">
          <Input id="rep-cost" inputMode="decimal" placeholder="CHF" value={cost} onChange={(e) => setCost(e.target.value)} className="w-36 tabular" />
        </Field>
      </div>
    </Dialog>
  );
}
