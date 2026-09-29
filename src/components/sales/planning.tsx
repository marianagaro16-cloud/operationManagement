'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import {
  AlertTriangle, ArrowDown, ArrowUp, Building2, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Home, Map, MapPinOff,
  Pencil, Plus, Route, Trash2, X,
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
import { overlapping, timeRange } from '@/domain/sales/times';
import {
  planActivity, recordActivity, removeActivity, saveStartPoint, setDayEnds, setRouteOrder, updateActivity,
} from '@/server/sales-actions';
import { KindBadge, KindIcon, useKinds } from './activity-kind';
import { PlanFields, emptyPlan, toPlanInput, type PlanDraft } from './plan-fields';
import type {
  ActivityKind, DayEnd, DayEnds, QuietCustomer, SalesActivity, StartPoint, VisitTarget,
} from '@/types/sales';

const shift = (date: string, days: number) => DateTime.fromISO(date, { zone: BUSINESS_TZ }).plus({ days }).toISODate()!;
const weekOf = (date: string) => {
  const monday = DateTime.fromISO(date, { zone: BUSINESS_TZ }).startOf('week');
  return Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }).toISODate()!);
};
const targetHref = (t: { kind: VisitTarget['kind']; id: string }) =>
  t.kind === 'customer' ? `/sales/customers/${t.id}` : `/sales/prospects/${t.id}`;

/** Where an appointment takes place, as a line. */
function usePlaceText() {
  const { t } = useI18n();
  return (a: SalesActivity): string | null => {
    switch (a.place) {
      case 'theirs': return a.target ? `${t('sales.placeTheirs')} · ${formatAddress(a.target) || '—'}` : t('sales.placeTheirs');
      case 'office': return t('sales.placeOffice');
      case 'online': return a.place_detail ? `${t('sales.placeOnline')} · ${a.place_detail}` : t('sales.placeOnline');
      case 'other': return a.place_detail ? `${t('sales.placeOther')} · ${a.place_detail}` : t('sales.placeOther');
      default: return null;
    }
  };
}

/**
 * A salesperson's planning: the week at a glance, the chosen day's calls,
 * appointments, emails, visits and messages in time order, and the day's
 * visits as a route in Google Maps. After each: what happened, and what
 * comes next.
 */
export function PlanningView({
  date,
  today,
  salespersonId,
  people,
  activities,
  week,
  counts,
  home,
  office,
  ends,
  places,
  quiet,
  kinds,
}: {
  date: string;
  today: string;
  salespersonId: string;
  people: { id: string; name: string }[];
  /** The chosen day's activities. */
  activities: SalesActivity[];
  /** The whole week's, Monday to Sunday — the computer's week view. */
  week: SalesActivity[];
  counts: Record<string, { planned: number; total: number }>;
  home: StartPoint | null;
  office: StartPoint | null;
  ends: DayEnds;
  places: VisitTarget[];
  quiet: QuietCustomer[];
  kinds: ActivityKind[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const k = useKinds(kinds);
  const placeText = usePlaceText();
  const [planning, setPlanning] = useState<{ target: VisitTarget | null; date: string } | null>(null);
  const [editing, setEditing] = useState<SalesActivity | null>(null);
  const [recording, setRecording] = useState<SalesActivity | null>(null);
  const [editingHome, setEditingHome] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = (params: { date?: string; person?: string }) =>
    router.push(`/sales?tab=planning&date=${params.date ?? date}&person=${params.person ?? salespersonId}`);
  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.error ?? '');
      router.refresh();
    });
  };

  // ---- the day's visits, as a route ----
  const visits = activities
    .filter((a) => k.get(a.kind_id)?.behavior === 'visit' && a.target)
    .sort((a, b) => a.position - b.position);
  const pointOf = (which: DayEnd) => {
    const p = which === 'home' ? home : office;
    return p ? { id: which, ...p } : null;
  };
  const startPlace = pointOf(ends.start_at);
  const links = visitRouteLinks(visits.map((v) => v.target!), startPlace, pointOf(ends.end_at));
  const unplaced = visits.filter((v) => v.target!.latitude === null).length;

  function propose() {
    run(() => setRouteOrder(orderVisits(visits.map((v) => ({ id: v.id, plannedTime: v.activity_time, place: v.target! })), startPlace)));
  }
  function move(index: number, by: -1 | 1) {
    const ids = visits.map((v) => v.id);
    const other = index + by;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    run(() => setRouteOrder(ids));
  }

  // ---- suggestions ----
  const onDay = new Set(activities.map((a) => a.target?.id).filter(Boolean));
  const quietSuggestions = quiet.filter((q) => !onDay.has(q.id)).slice(0, 5);
  const nearby = useMemo(
    () => nearbyPlaces(places, visits.map((v) => v.target!)).filter((n) => !onDay.has(n.place.id)).slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [places, activities],
  );
  const placeOf = (id: string) => places.find((p) => p.kind === 'customer' && p.id === id);
  // What crosses what in time, among what is still planned.
  const crossing = overlapping(
    activities.filter((a) => a.status === 'planned').map((a) => ({ id: a.id, start: a.activity_time, end: a.activity_end, a })),
  );

  return (
    <div className="space-y-4">
      {/* The week, and whose */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label={t('sales.planPrevWeek')} onClick={() => go({ date: shift(date, -7) })}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Input type="date" aria-label={t('sales.visitDay')} value={date} onChange={(e) => e.target.value && go({ date: e.target.value })} className="w-auto" />
          <Button size="icon" variant="ghost" aria-label={t('sales.planNextWeek')} onClick={() => go({ date: shift(date, 7) })}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          {date !== today && <Button size="sm" variant="ghost" onClick={() => go({ date: today })}>{t('common.today')}</Button>}
        </div>
        {people.length > 1 && (
          <Select aria-label={t('sales.owner')} value={salespersonId} onChange={(e) => go({ person: e.target.value })} className="w-auto">
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
      </div>

      {/* The computer: the whole week at once, seven columns. */}
      <WeekGrid
        week={week}
        date={date}
        today={today}
        kinds={kinds}
        pending={pending}
        onSelect={(d) => go({ date: d })}
        onPlan={(d) => setPlanning({ target: null, date: d })}
        onRecord={setRecording}
        onEdit={setEditing}
        onRemove={(a) => run(() => removeActivity(a.id))}
      />

      {/* The phone: the strip, and one day at a time. */}
      <div className="space-y-4 lg:hidden">
      <div className="grid grid-cols-7 gap-1" role="tablist" aria-label={t('sales.planWeek')}>
        {weekOf(date).map((d) => {
          const c = counts[d];
          const selected = d === date;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => go({ date: d })}
              className={cn(
                'rounded-lg border px-1 py-1.5 text-center transition-colors',
                selected ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-surface hover:bg-surface-2',
                d === today && !selected && 'border-accent/50',
              )}
            >
              <span className="block text-[10.5px] font-medium uppercase opacity-80">{formatDate(d, 'weekday').slice(0, 2)}</span>
              <span className="block text-[14px] font-semibold tabular">{d.slice(8)}</span>
              <span className={cn('block text-[10.5px] tabular', selected ? 'opacity-90' : 'text-muted')}>
                {c ? (c.planned > 0 ? c.planned : '✓') : '·'}
              </span>
            </button>
          );
        })}
      </div>

      </div>

      {error && <ErrorState message={error} />}

      <div className="space-y-4 lg:hidden">
      {/* The day */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold capitalize">
          {formatDate(date, 'weekday')} <span className="text-[12px] font-normal tabular text-muted">{activities.length}</span>
        </h2>
        <Button size="sm" variant="primary" onClick={() => setPlanning({ target: null, date })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('sales.planAdd')}
        </Button>
      </div>

      {activities.length === 0 ? (
        <EmptyState title={t('sales.planNone')} body={t('sales.planNoneBody')} />
      ) : (
        <Card className="divide-y divide-border">
          {activities.map((a) => {
            const kind = k.get(a.kind_id);
            const where = placeText(a);
            return (
              <div key={a.id} className={cn('flex items-start gap-3 px-3 py-2.5', a.status !== 'planned' && 'opacity-70')}>
                <span className="mt-0.5 w-11 shrink-0 text-[12.5px] font-semibold leading-tight tabular">
                  {a.activity_time ? a.activity_time.slice(0, 5) : <span className="text-subtle">—</span>}
                  {a.activity_end && <span className="block text-[11.5px] font-normal text-muted">{a.activity_end.slice(0, 5)}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <KindBadge kind={kind} />
                    {a.target ? (
                      <Link href={targetHref(a.target)} className="truncate text-[13.5px] font-medium hover:text-accent">{a.target.name}</Link>
                    ) : (
                      <span className="truncate text-[13.5px] font-medium">{a.title}</span>
                    )}
                    {a.target?.kind === 'prospect' && <Badge tone="warn">{t('sales.visitProspect')}</Badge>}
                    {a.status === 'done' && <Badge tone="done"><Check className="h-3 w-3" aria-hidden />{t('sales.visitDone')}</Badge>}
                    {a.status === 'not_done' && <Badge tone="neutral"><X className="h-3 w-3" aria-hidden />{t('sales.visitNotDone')}</Badge>}
                  </div>
                  {a.target && a.title && <p className="text-[12px]">{a.title}</p>}
                  {a.event && (
                    <Link href={`/events/${a.event.id}`} className="block truncate text-[12px] text-accent hover:underline">
                      {t('event.taskOf', { name: a.event.name })}
                    </Link>
                  )}
                  {where && <p className="truncate text-[12px] text-muted">{where}</p>}
                  {crossing.has(a.id) && (
                    <p className="flex items-center gap-1 text-[12px] font-medium text-warn">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      {t('sales.planOverlaps', {
                        with: crossing.get(a.id)!.map((o) => `${o.a.target?.name ?? o.a.title ?? ''} (${timeRange(o.start, o.end)})`).join(', '),
                      })}
                    </p>
                  )}
                  {kind?.behavior === 'visit' && a.target && (
                    <p className="truncate text-[12px] text-muted">
                      {formatAddress(a.target) || '—'}
                      {a.target.latitude === null && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-warn">
                          <MapPinOff className="h-3 w-3" aria-hidden />
                          {t('sales.visitUnplaced')}
                        </span>
                      )}
                    </p>
                  )}
                  {a.status === 'planned' && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Button size="sm" variant="primary" onClick={() => setRecording(a)}>{t('sales.visitRecord')}</Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('common.edit')} onClick={() => setEditing(a)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted hover:text-late" aria-label={t('sales.planRemove')} disabled={pending} onClick={() => run(() => removeActivity(a.id))}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}
      </div>

      {/* The route of the chosen day: only when it has visits */}
      {visits.length > 0 && (
        <p className="hidden text-[13px] font-medium capitalize text-muted lg:block">{formatDate(date, 'weekday')}</p>
      )}
      {visits.length > 0 && (
        <Card className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-[14px] font-semibold">
              <Route className="h-4 w-4 text-accent" aria-hidden />
              {t('sales.planRoute')}
            </h2>
            {visits.length > 1 && (
              <Button size="sm" variant="secondary" onClick={propose} disabled={pending}>{t('sales.visitPropose')}</Button>
            )}
          </div>

          {(['start_at', 'end_at'] as const).map((which) => {
            const chosen = ends[which];
            const point = chosen === 'home' ? home : office;
            const label = which === 'start_at' ? t('sales.visitStartLabel') : t('sales.visitEndLabel');
            return (
              <div key={which} className="flex flex-wrap items-center gap-2">
                <span className="w-16 shrink-0 text-[12.5px] font-medium text-muted">{label}</span>
                <div className="flex gap-1 rounded-lg border border-border p-0.5" role="radiogroup" aria-label={label}>
                  {(['home', 'office'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={chosen === option}
                      disabled={pending}
                      onClick={() => chosen !== option && run(() => setDayEnds({ salesperson_id: salespersonId, visit_date: date, ...ends, [which]: option }))}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px] font-medium',
                        chosen === option ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
                      )}
                    >
                      {option === 'home' ? <Home className="h-3.5 w-3.5" aria-hidden /> : <Building2 className="h-3.5 w-3.5" aria-hidden />}
                      {option === 'home' ? t('sales.visitHome') : t('sales.visitOffice')}
                    </button>
                  ))}
                </div>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                  {point && formatAddress(point) ? formatAddress(point) : (
                    <span className="text-warn">{chosen === 'home' ? t('sales.visitNoStart') : t('sales.visitNoOffice')}</span>
                  )}
                </span>
              </div>
            );
          })}

          <ol className="divide-y divide-border rounded-lg border border-border">
            {visits.map((v, i) => (
              <li key={v.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[12px] font-semibold tabular text-accent">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{v.target!.name}</span>
                {v.activity_time && <span className="inline-flex items-center gap-0.5 text-[12px] tabular text-muted"><Clock className="h-3 w-3" aria-hidden />{timeRange(v.activity_time, v.activity_end)}</span>}
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('sales.visitUp')} disabled={pending || i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('sales.visitDown')} disabled={pending || i === visits.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ol>

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
            {unplaced > 0 && <span className="text-[12px] text-warn">{t('sales.visitUnplacedCount', { count: unplaced })}</span>}
            <Button size="sm" variant="ghost" onClick={() => setEditingHome(true)}>
              <Home className="h-3.5 w-3.5" aria-hidden />
              {t('sales.visitEditHome')}
            </Button>
          </div>
        </Card>
      )}

      {/* Whom else */}
      {(quietSuggestions.length > 0 || nearby.length > 0) && (
        <Card className="space-y-3 p-3.5">
          <h2 className="text-[14px] font-semibold">{t('sales.visitSuggestions')}</h2>
          <Suggestions
            title={t('sales.tabQuiet')}
            items={quietSuggestions.map((q) => ({
              target: placeOf(q.id),
              detail: q.late ? t('sales.quietLate', { days: q.days_since, rhythm: q.rhythm_days }) : `${q.change_pct}%`,
            }))}
            onPlan={(target) => setPlanning({ target, date })}
          />
          <Suggestions
            title={t('sales.visitSuggestNearby')}
            items={nearby.map((n) => ({ target: n.place, detail: `${n.km.toFixed(1)} km` }))}
            onPlan={(target) => setPlanning({ target, date })}
          />
        </Card>
      )}

      {planning && (
        <PlanDialog
          target={planning.target}
          places={places}
          kinds={kinds}
          salespersonId={salespersonId}
          date={planning.date}
          today={today}
          onClose={() => setPlanning(null)}
        />
      )}
      {editing && <EditDialog activity={editing} kinds={kinds} today={today} onClose={() => setEditing(null)} />}
      {recording && <RecordDialog activity={recording} kinds={kinds} today={today} onClose={() => setRecording(null)} />}
      {editingHome && <HomeDialog userId={salespersonId} home={home} onClose={() => setEditingHome(false)} />}
    </div>
  );
}

function Suggestions({
  title,
  items,
  onPlan,
}: {
  title: string;
  items: { target: VisitTarget | undefined; detail: string }[];
  onPlan: (t: VisitTarget) => void;
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
            <Button size="sm" variant="ghost" onClick={() => onPlan(target)}>
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              {t('sales.planShort')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Plan an activity: about a customer, a prospect, or nobody (then it says what). */
function PlanDialog({
  target,
  places,
  kinds,
  salespersonId,
  date,
  today,
  onClose,
}: {
  target: VisitTarget | null;
  places: VisitTarget[];
  kinds: ActivityKind[];
  salespersonId: string;
  date: string;
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [chosen, setChosen] = useState<VisitTarget | null>(target);
  const [free, setFree] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<PlanDraft>(emptyPlan(date < today ? today : date, kinds));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const matches = q ? places.filter((p) => `${p.name} ${p.city ?? ''}`.toLowerCase().includes(q)).slice(0, 12) : [];
  const plan = toPlanInput(draft, kinds, free);
  const ready = !!plan && (free || !!chosen);

  function submit() {
    if (!ready || !plan) return;
    setError(null);
    startTransition(async () => {
      const res = await planActivity({
        ...plan,
        salesperson_id: salespersonId,
        customer_id: !free && chosen?.kind === 'customer' ? chosen.id : null,
        prospect_id: !free && chosen?.kind === 'prospect' ? chosen.id : null,
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
      title={t('sales.planAdd')}
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
        {!target && (
          <div className="flex gap-1 rounded-lg border border-border p-0.5" role="radiogroup" aria-label={t('sales.planAbout')}>
            {([false, true] as const).map((isFree) => (
              <button
                key={String(isFree)}
                type="button"
                role="radio"
                aria-checked={free === isFree}
                onClick={() => setFree(isFree)}
                className={cn('flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium', free === isFree ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
              >
                {isFree ? t('sales.planFree') : t('sales.visitWho')}
              </button>
            ))}
          </div>
        )}
        {!free && (chosen ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-medium">{chosen.name}</span>
              <span className="block truncate text-[12px] text-muted">
                {chosen.kind === 'prospect' ? `${t('sales.visitProspect')} · ` : ''}{formatAddress(chosen) || '—'}
              </span>
            </span>
            {!target && <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>{t('common.edit')}</Button>}
          </div>
        ) : (
          <Field label={t('sales.visitWho')} htmlFor="plan-search">
            <Input id="plan-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('sales.search')} autoFocus />
            {matches.length > 0 && (
              <ul className="mt-1 max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {matches.map((p) => (
                  <li key={`${p.kind}-${p.id}`}>
                    <button type="button" onClick={() => setChosen(p)} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
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
        ))}
        <PlanFields
          draft={draft}
          onChange={setDraft}
          kinds={kinds}
          today={today}
          idPrefix="plan"
          titleLabel={free ? t('sales.planWhat') : undefined}
          titleRequired={free}
        />
      </div>
    </Dialog>
  );
}

/** Move a planned activity, or change what it says. */
function EditDialog({ activity, kinds, today, onClose }: { activity: SalesActivity; kinds: ActivityKind[]; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<PlanDraft>({
    kind_id: activity.kind_id,
    activity_date: activity.activity_date,
    activity_time: activity.activity_time?.slice(0, 5) ?? '',
    activity_end: activity.activity_end?.slice(0, 5) ?? '',
    title: activity.title ?? '',
    place: activity.place ?? '',
    place_detail: activity.place_detail ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const plan = toPlanInput(draft, kinds, !activity.target);

  function submit() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const res = await updateActivity(activity.id, plan);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={activity.target?.name ?? activity.title ?? t('common.edit')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!plan}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <PlanFields draft={draft} onChange={setDraft} kinds={kinds} today={today} idPrefix="edit" titleRequired={!activity.target} />
      </div>
    </Dialog>
  );
}

/** After the activity: done or not, what happened, and — optionally — what comes next. */
function RecordDialog({ activity, kinds, today, onClose }: { activity: SalesActivity; kinds: ActivityKind[]; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState<'done' | 'not_done'>('done');
  const [note, setNote] = useState('');
  const [planNext, setPlanNext] = useState(false);
  const [next, setNext] = useState<PlanDraft>({ ...emptyPlan(shift(today, 1), kinds), kind_id: activity.kind_id });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextPlan = planNext ? toPlanInput(next, kinds, !activity.target) : null;

  function submit() {
    if (planNext && !nextPlan) return;
    setError(null);
    startTransition(async () => {
      const res = await recordActivity({ activity_id: activity.id, status, note: note || null, next: nextPlan });
      if (!res.ok) return setError(res.error);
      router.refresh();
      if (res.data.next === 'failed') return setError(t('sales.planNextFailed'));
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={activity.target?.name ?? activity.title ?? ''}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={planNext && !nextPlan}>{t('common.save')}</Button>
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
              className={cn('flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium', status === s ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
            >
              {s === 'done' ? t('sales.visitDone') : t('sales.visitNotDone')}
            </button>
          ))}
        </div>
        <Field
          label={t('sales.visitWhatHappened')}
          hint={activity.target ? t('sales.visitNoteHint') : undefined}
          htmlFor="record-note"
        >
          <NoteTextarea id="record-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={planNext} onChange={(e) => setPlanNext(e.target.checked)} />
          {t('sales.planNext')}
        </label>
        {planNext && (
          <div className="rounded-lg border border-accent/25 bg-accent/[0.04] p-3">
            <PlanFields draft={next} onChange={setNext} kinds={kinds} today={today} idPrefix="next" titleRequired={!activity.target} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function HomeDialog({ userId, home, onClose }: { userId: string; home: StartPoint | null; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [street, setStreet] = useState(home?.street ?? '');
  const [postalCode, setPostalCode] = useState(home?.postal_code ?? '');
  const [city, setCity] = useState(home?.city ?? '');
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
      title={t('sales.visitHomeAddress')}
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
        <Field label={t('sales.street')} htmlFor="home-street">
          <Input id="home-street" value={street} onChange={(e) => setStreet(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label={t('sales.postalCode')} htmlFor="home-zip">
            <Input id="home-zip" inputMode="numeric" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </Field>
          <Field label={t('sales.city')} htmlFor="home-city">
            <Input id="home-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The week on a computer: Monday to Sunday side by side, each day's
 * activities by time, with the result, edit and remove at hand and a "+"
 * to plan on that day. Choosing a day shows its visit route below.
 */
function WeekGrid({
  week,
  date,
  today,
  kinds,
  pending,
  onSelect,
  onPlan,
  onRecord,
  onEdit,
  onRemove,
}: {
  week: SalesActivity[];
  date: string;
  today: string;
  kinds: ActivityKind[];
  pending: boolean;
  onSelect: (day: string) => void;
  onPlan: (day: string) => void;
  onRecord: (a: SalesActivity) => void;
  onEdit: (a: SalesActivity) => void;
  onRemove: (a: SalesActivity) => void;
}) {
  const { t, formatDate } = useI18n();
  const k = useKinds(kinds);
  return (
    <div className="hidden grid-cols-7 gap-2 lg:grid">
      {weekOf(date).map((d) => {
        const list = week.filter((a) => a.activity_date === d);
        const crossing = overlapping(
          list.filter((a) => a.status === 'planned').map((a) => ({ id: a.id, start: a.activity_time, end: a.activity_end })),
        );
        const selected = d === date;
        return (
          <div
            key={d}
            className={cn(
              'flex min-w-0 flex-col rounded-xl border bg-surface',
              selected ? 'border-accent' : d === today ? 'border-accent/40' : 'border-border',
            )}
          >
            <div className="flex items-center justify-between gap-1 border-b border-border px-2 py-1.5">
              <button
                type="button"
                onClick={() => onSelect(d)}
                aria-pressed={selected}
                className="min-w-0 text-left"
              >
                <span className={cn('block text-[11px] font-medium uppercase', d === today ? 'text-accent' : 'text-muted')}>
                  {formatDate(d, 'weekday').split(/[\s,]/)[0]}
                </span>
                <span className="block text-[15px] font-semibold leading-tight tabular">{formatDate(d, 'short')}</span>
              </button>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t('sales.planAdd')} onClick={() => onPlan(d)}>
                <Plus className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div className="flex-1 space-y-1.5 p-1.5">
              {list.length === 0 && <p className="px-1 py-2 text-center text-[11.5px] text-subtle">—</p>}
              {list.map((a) => {
                const kind = k.get(a.kind_id);
                const range = timeRange(a.activity_time, a.activity_end);
                return (
                  <div
                    key={a.id}
                    className={cn(
                      'rounded-lg border border-border bg-surface-2/40 px-2 py-1.5',
                      a.status !== 'planned' && 'opacity-60',
                      crossing.has(a.id) && 'border-warn/50',
                    )}
                  >
                    <div className="flex items-center gap-1 text-[11.5px] font-semibold tabular">
                      {kind && <KindIcon icon={kind.icon} className="h-3 w-3 shrink-0 text-accent" />}
                      <span className="truncate">{range ?? k.name(a.kind_id)}</span>
                      {a.status === 'done' && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-done" aria-label={t('sales.visitDone')} />}
                      {a.status === 'not_done' && <X className="ml-auto h-3.5 w-3.5 shrink-0 text-muted" aria-label={t('sales.visitNotDone')} />}
                      {crossing.has(a.id) && (
                        <AlertTriangle className="ml-auto h-3.5 w-3.5 shrink-0 text-warn" aria-label={t('sales.planOverlapsShort')} />
                      )}
                    </div>
                    {a.target ? (
                      <Link href={targetHref(a.target)} className="line-clamp-2 break-words text-[12.5px] font-medium leading-snug hover:text-accent">
                        {a.target.name}
                      </Link>
                    ) : a.event ? (
                      <Link href={`/events/${a.event.id}`} title={a.event.name} className="line-clamp-2 break-words text-[12.5px] font-medium leading-snug hover:text-accent">
                        {a.title}
                      </Link>
                    ) : (
                      <p className="line-clamp-2 break-words text-[12.5px] font-medium leading-snug">{a.title}</p>
                    )}
                    {range && <p className="truncate text-[11px] text-muted">{k.name(a.kind_id)}</p>}
                    {a.status === 'planned' && (
                      <div className="mt-1 flex items-center gap-0.5">
                        <Button size="sm" variant="primary" className="h-6 px-2 text-[11px]" onClick={() => onRecord(a)}>
                          {t('sales.visitRecord')}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={t('common.edit')} onClick={() => onEdit(a)}>
                          <Pencil className="h-3 w-3" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted hover:text-late"
                          aria-label={t('sales.planRemove')}
                          disabled={pending}
                          onClick={() => onRemove(a)}
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
