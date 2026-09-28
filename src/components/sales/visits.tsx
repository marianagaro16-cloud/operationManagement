'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import {
  ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Clock, Home, Map, MapPinOff, Plus, Route, Trash2, X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { formatAddress } from '@/domain/orders/route';
import { nearbyPlaces, orderVisits, visitRouteLinks } from '@/domain/sales/visits';
import { addVisit, recordVisit, removeVisit, saveStartPoint, setVisitOrder } from '@/server/sales-actions';
import type { Prospect, QuietCustomer, SalesVisit, StartPoint, VisitTarget } from '@/types/sales';

const shift = (date: string, days: number) =>
  DateTime.fromISO(date, { zone: BUSINESS_TZ }).plus({ days }).toISODate()!;

const targetHref = (t: { kind: VisitTarget['kind']; id: string }) =>
  t.kind === 'customer' ? `/sales/customers/${t.id}` : `/sales/prospects/${t.id}`;

/**
 * A salesperson's day of visits: whom, in which order, the route in Google
 * Maps, and — after each one — what happened.
 */
export function VisitsView({
  date,
  today,
  salespersonId,
  people,
  visits,
  start,
  places,
  quiet,
  dueProspects,
}: {
  date: string;
  today: string;
  salespersonId: string;
  people: { id: string; name: string }[];
  visits: SalesVisit[];
  start: StartPoint | null;
  places: VisitTarget[];
  quiet: QuietCustomer[];
  dueProspects: Prospect[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [adding, setAdding] = useState<VisitTarget | 'search' | null>(null);
  const [recording, setRecording] = useState<SalesVisit | null>(null);
  const [editingStart, setEditingStart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = (params: { date?: string; person?: string }) =>
    router.push(`/sales?tab=visits&date=${params.date ?? date}&person=${params.person ?? salespersonId}`);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.error ?? '');
      router.refresh();
    });
  };

  const startPlace = start ? { id: 'start', ...start } : null;
  const links = visitRouteLinks(visits.map((v) => v.target), startPlace);
  const unplaced = visits.filter((v) => v.target.latitude === null).length;

  function propose() {
    const order = orderVisits(
      visits.map((v) => ({ id: v.id, plannedTime: v.planned_time, place: v.target })),
      startPlace,
    );
    run(() => setVisitOrder(order));
  }

  function move(index: number, by: -1 | 1) {
    const ids = visits.map((v) => v.id);
    const other = index + by;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    run(() => setVisitOrder(ids));
  }

  // Suggestions: not already on this day's plan.
  const onPlan = new Set(visits.map((v) => v.target.id));
  const quietSuggestions = quiet.filter((q) => !onPlan.has(q.id)).slice(0, 6);
  const prospectSuggestions = dueProspects.filter((p) => !onPlan.has(p.id)).slice(0, 6);
  const nearby = useMemo(
    () => nearbyPlaces(places, visits.map((v) => v.target)).slice(0, 6),
    [places, visits],
  );
  const placeOf = (kind: VisitTarget['kind'], id: string) => places.find((p) => p.kind === kind && p.id === id);

  return (
    <div className="space-y-4">
      {/* The day, and whose */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label={t('sales.visitPrevDay')} onClick={() => go({ date: shift(date, -1) })}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Input
            type="date"
            aria-label={t('sales.visitDay')}
            value={date}
            onChange={(e) => e.target.value && go({ date: e.target.value })}
            className="w-auto"
          />
          <Button size="icon" variant="ghost" aria-label={t('sales.visitNextDay')} onClick={() => go({ date: shift(date, 1) })}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          {date !== today && (
            <Button size="sm" variant="ghost" onClick={() => go({ date: today })}>{t('common.today')}</Button>
          )}
        </div>
        {people.length > 1 && (
          <Select
            aria-label={t('sales.owner')}
            value={salespersonId}
            onChange={(e) => go({ person: e.target.value })}
            className="w-auto"
          >
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
      </div>
      <p className="-mt-2 text-[13px] font-medium capitalize">{formatDate(date, 'weekday')}</p>

      {/* Where the day starts and ends */}
      <Card className="flex items-center gap-3 p-3">
        <Home className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 text-[12.5px]">
          <span className="text-muted">{t('sales.visitStart')}: </span>
          {start && formatAddress(start) ? formatAddress(start) : <span className="text-warn">{t('sales.visitNoStart')}</span>}
          {start && formatAddress(start) && start.latitude === null && (
            <span className="block text-[12px] text-warn">{t('sales.visitStartUnplaced')}</span>
          )}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setEditingStart(true)}>{t('common.edit')}</Button>
      </Card>

      {error && <ErrorState message={error} />}

      {/* The route */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          {t('sales.visitsOfDay')} <span className="text-[12px] font-normal tabular text-muted">{visits.length}</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAdding('search')}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('sales.visitAdd')}
          </Button>
          {visits.length > 1 && (
            <Button size="sm" variant="secondary" onClick={propose} disabled={pending}>
              <Route className="h-3.5 w-3.5" aria-hidden />
              {t('sales.visitPropose')}
            </Button>
          )}
        </div>
      </div>

      {visits.length === 0 ? (
        <EmptyState title={t('sales.visitNone')} body={t('sales.visitNoneBody')} />
      ) : (
        <>
          <Card className="divide-y divide-border">
            {visits.map((v, i) => (
              <div key={v.id} className="flex items-start gap-3 px-3 py-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[12px] font-semibold tabular text-accent">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={targetHref(v.target)} className="truncate text-[13.5px] font-medium hover:text-accent">
                      {v.target.name}
                    </Link>
                    {v.target.kind === 'prospect' && <Badge tone="warn">{t('sales.visitProspect')}</Badge>}
                    {v.planned_time && (
                      <span className="inline-flex items-center gap-0.5 text-[12px] font-medium tabular">
                        <Clock className="h-3 w-3" aria-hidden />
                        {v.planned_time.slice(0, 5)}
                      </span>
                    )}
                    {v.status === 'done' && <Badge tone="done"><Check className="h-3 w-3" aria-hidden />{t('sales.visitDone')}</Badge>}
                    {v.status === 'not_done' && <Badge tone="neutral"><X className="h-3 w-3" aria-hidden />{t('sales.visitNotDone')}</Badge>}
                  </div>
                  <p className="truncate text-[12px] text-muted">
                    {formatAddress(v.target) || '—'}
                    {v.target.latitude === null && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-warn">
                        <MapPinOff className="h-3 w-3" aria-hidden />
                        {t('sales.visitUnplaced')}
                      </span>
                    )}
                  </p>
                  {v.purpose && <p className="text-[12px]">{v.purpose}</p>}
                  {v.status === 'planned' && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Button size="sm" variant="primary" onClick={() => setRecording(v)}>{t('sales.visitRecord')}</Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('sales.visitUp')} disabled={pending || i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('sales.visitDown')} disabled={pending || i === visits.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted hover:text-late" aria-label={t('sales.visitRemove')} disabled={pending} onClick={() => run(() => removeVisit(v.id))}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </Card>

          {links.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {links.map((href, i) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:opacity-90"
                >
                  <Map className="h-4 w-4" aria-hidden />
                  {links.length === 1 ? t('sales.visitOpenRoute') : t('sales.visitOpenLeg', { n: i + 1 })}
                </a>
              ))}
              {!start?.latitude && <span className="text-[12px] text-muted">{t('sales.visitRouteNoStart')}</span>}
              {unplaced > 0 && <span className="text-[12px] text-warn">{t('sales.visitUnplacedCount', { count: unplaced })}</span>}
            </div>
          )}
        </>
      )}

      {/* Whom else */}
      {(quietSuggestions.length > 0 || prospectSuggestions.length > 0 || nearby.length > 0) && (
        <Card className="space-y-3 p-3.5">
          <h2 className="text-[14px] font-semibold">{t('sales.visitSuggestions')}</h2>
          <Suggestions
            title={t('sales.tabQuiet')}
            items={quietSuggestions.map((q) => ({ target: placeOf('customer', q.id), detail: q.late ? t('sales.quietLate', { days: q.days_since, rhythm: q.rhythm_days }) : `${q.change_pct}%` }))}
            onAdd={setAdding}
          />
          <Suggestions
            title={t('sales.visitSuggestProspects')}
            items={prospectSuggestions.map((p) => ({ target: placeOf('prospect', p.id), detail: `${p.next_step ?? ''} · ${formatDate(p.next_step_on!, 'short')}` }))}
            onAdd={setAdding}
          />
          <Suggestions
            title={t('sales.visitSuggestNearby')}
            items={nearby.map((n) => ({ target: n.place, detail: `${n.km.toFixed(1)} km` }))}
            onAdd={setAdding}
          />
        </Card>
      )}

      {adding && (
        <AddVisitDialog
          target={adding === 'search' ? null : adding}
          places={places.filter((p) => !onPlan.has(p.id))}
          salespersonId={salespersonId}
          date={date}
          onClose={() => setAdding(null)}
        />
      )}
      {recording && <RecordDialog visit={recording} today={today} onClose={() => setRecording(null)} />}
      {editingStart && <StartDialog userId={salespersonId} start={start} onClose={() => setEditingStart(false)} />}
    </div>
  );
}

function Suggestions({
  title,
  items,
  onAdd,
}: {
  title: string;
  items: { target: VisitTarget | undefined; detail: string }[];
  onAdd: (t: VisitTarget) => void;
}) {
  const { t } = useI18n();
  const shown = items.filter((i): i is { target: VisitTarget; detail: string } => !!i.target);
  if (shown.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {shown.map(({ target, detail }) => (
          <li key={`${target.kind}-${target.id}`} className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{target.name}</span>
              <span className="block truncate text-[11.5px] text-muted">{detail}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => onAdd(target)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('sales.visitAddShort')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddVisitDialog({
  target,
  places,
  salespersonId,
  date,
  onClose,
}: {
  target: VisitTarget | null;
  places: VisitTarget[];
  salespersonId: string;
  date: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [chosen, setChosen] = useState<VisitTarget | null>(target);
  const [query, setQuery] = useState('');
  const [time, setTime] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const matches = q
    ? places.filter((p) => `${p.name} ${p.city ?? ''}`.toLowerCase().includes(q)).slice(0, 12)
    : [];

  function submit() {
    if (!chosen) return;
    setError(null);
    startTransition(async () => {
      const res = await addVisit({
        salesperson_id: salespersonId,
        visit_date: date,
        kind: chosen.kind,
        target_id: chosen.id,
        planned_time: time || null,
        purpose: purpose || null,
      });
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('sales.visitAdd')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!chosen}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {chosen ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-medium">{chosen.name}</span>
              <span className="block truncate text-[12px] text-muted">
                {chosen.kind === 'prospect' ? `${t('sales.visitProspect')} · ` : ''}{formatAddress(chosen) || '—'}
              </span>
            </span>
            {!target && (
              <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>{t('common.edit')}</Button>
            )}
          </div>
        ) : (
          <Field label={t('sales.visitWho')} htmlFor="visit-search">
            <Input id="visit-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('sales.search')} autoFocus />
            {matches.length > 0 && (
              <ul className="mt-1 max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {matches.map((p) => (
                  <li key={`${p.kind}-${p.id}`}>
                    <button
                      type="button"
                      onClick={() => setChosen(p)}
                      className="block w-full px-3 py-1.5 text-left hover:bg-surface-2"
                    >
                      <span className="block truncate text-[13px]">{p.name}</span>
                      <span className="block truncate text-[11.5px] text-muted">
                        {p.kind === 'prospect' ? `${t('sales.visitProspect')} · ` : ''}{p.city ?? ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        )}
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label={t('sales.visitTime')} hint={t('sales.visitTimeHint')} htmlFor="visit-time">
            <Input id="visit-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label={t('sales.visitPurpose')} htmlFor="visit-purpose">
            <Input id="visit-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t('sales.visitPurposePlaceholder')} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function RecordDialog({ visit, today, onClose }: { visit: SalesVisit; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState<'done' | 'not_done'>('done');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isProspect = visit.target.kind === 'prospect';

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await recordVisit({
        visit_id: visit.id,
        status,
        note: note || null,
        follow_up_on: !isProspect ? followUp || null : null,
        next_step: isProspect ? nextStep || null : null,
        next_step_on: isProspect ? followUp || null : null,
      });
      if (!res.ok) return setError(res.error);
      router.refresh();
      if (res.data.followUp === 'failed') return setError(t('sales.followUpFailed'));
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={visit.target.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={isProspect && !!followUp && !nextStep.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <div className="flex gap-1 rounded-lg border border-border p-0.5" role="radiogroup" aria-label={t('sales.visitRecord')}>
          {(['done', 'not_done'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium',
                status === s ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
              )}
            >
              {s === 'done' ? t('sales.visitDone') : t('sales.visitNotDone')}
            </button>
          ))}
        </div>
        <Field label={t('sales.visitWhatHappened')} hint={t('sales.visitNoteHint')} htmlFor="visit-note">
          <NoteTextarea id="visit-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
        {isProspect ? (
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label={t('sales.nextStep')} htmlFor="visit-next">
              <Input id="visit-next" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder={t('sales.nextStepPlaceholder')} />
            </Field>
            <Field label={t('sales.nextStepOn')} htmlFor="visit-next-on">
              <Input id="visit-next-on" type="date" min={today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label={t('sales.followUp')} hint={t('sales.followUpHint')} htmlFor="visit-follow">
            <Input id="visit-follow" type="date" min={today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="max-w-48" />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function StartDialog({ userId, start, onClose }: { userId: string; start: StartPoint | null; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [street, setStreet] = useState(start?.street ?? '');
  const [postalCode, setPostalCode] = useState(start?.postal_code ?? '');
  const [city, setCity] = useState(start?.city ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveStartPoint({ user_id: userId, street, postal_code: postalCode, city });
      if (!res.ok) return setError(res.error);
      router.refresh();
      if (!res.data.placed) return setError(t('sales.visitStartUnplaced'));
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('sales.visitStart')}
      description={t('sales.visitStartHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!street.trim() && !city.trim()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('sales.street')} htmlFor="start-street">
          <Input id="start-street" value={street} onChange={(e) => setStreet(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label={t('sales.postalCode')} htmlFor="start-zip">
            <Input id="start-zip" inputMode="numeric" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </Field>
          <Field label={t('sales.city')} htmlFor="start-city">
            <Input id="start-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
