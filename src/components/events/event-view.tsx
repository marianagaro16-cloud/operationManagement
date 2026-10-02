'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ban, Check, CheckCircle2, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { localizedName } from '@/lib/localized-content';
import { timeRange } from '@/domain/sales/times';
import { recordActivity, removeActivity } from '@/server/sales-actions';
import {
  addEventTask,
  addShift,
  cancelEvent,
  confirmEvent,
  deleteIdea,
  removeCost,
  removeShift,
  saveCost,
  updateEventTask,
} from '@/server/event-actions';
import type { SalesActivity } from '@/types/sales';
import type { DeliveryMethod, Product } from '@/types/orders';
import type {
  EventContact,
  EventCost,
  EventFile,
  EventListEntry,
  EventNote,
  EventOrder,
  EventProduct,
  EventReturn,
  EventRow,
  EventShift,
  StaffCandidate,
} from '@/types/events';
import { ContactsCard, FilesCard, NotesCard, ResultsCard, ResultsDialog, hasResults } from './event-after';
import { StageBadge, chf, useEventLabels, useEventsLimited, useEventsReadOnly } from './event-parts';
import { QuickReminderButton } from '@/components/reminders/reminder-actions';
import { EventDialog, type EventChoices } from './event-dialog';
import { EventProducts, deliveryDateOf } from './event-products';

type Busy = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => void;

/** One event: what, when, where; its stage; its tasks, its staff and its budget. */
export function EventView({
  event,
  tasks,
  shifts,
  costs,
  order,
  products,
  returns,
  notes,
  files,
  contacts,
  catalog,
  methods,
  choices,
  staff,
  costTypes,
  today,
}: {
  event: EventRow;
  tasks: SalesActivity[];
  shifts: EventShift[];
  costs: EventCost[];
  order: EventOrder | null;
  products: EventProduct[];
  returns: EventReturn[];
  notes: EventNote[];
  files: EventFile[];
  contacts: EventContact[];
  /** Every product, for names; the editor offers the active ones. */
  catalog: Product[];
  methods: DeliveryMethod[];
  choices: EventChoices;
  staff: StaffCandidate[];
  costTypes: EventListEntry[];
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const readOnly = useEventsReadOnly();
  const limited = useEventsLimited();
  const live = !readOnly && (event.stage === 'idea' || event.stage === 'confirmed');

  const run: Busy = (fn, after) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      after?.();
      if (!res.ok) return setError(labels.error(res.error ?? ''));
      router.refresh();
    });
  };

  const hours = timeRange(event.open_time, event.close_time);
  const place = labels.place(event);
  const mapsHref = place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : null;

  return (
    <>
      <Link href="/events" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('event.navLabel')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold leading-tight">{event.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              <StageBadge stage={event.stage} />
              <span>{labels.entry(choices.kinds, event.kind_id)}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <QuickReminderButton viewerId={choices.viewerId} variant="ghost" compact link={{ type: 'event', id: event.id, label: event.name }} />
            {live && (
              <Button size="icon" variant="ghost" aria-label={t('event.edit')} onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>

        <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[9rem_1fr]">
          <Detail label={t('event.when')}>
            <span className="tabular">{labels.dates(event)}{hours && ` · ${hours}`}</span>
          </Detail>
          {place && (
            <Detail label={t('event.where')}>
              <a href={mapsHref!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {place}
              </a>
            </Detail>
          )}
          {event.customer_id && (
            <Detail label={t('event.customer')}>
              <Link href={`/sales/customers/${event.customer_id}`} className="hover:text-accent">{event.customer_name}</Link>
            </Detail>
          )}
          <Detail label={t('event.owner')}>
            {event.owner_name ?? <span className="text-late">{t('event.noOwner')}</span>}
          </Detail>
        </dl>
        {event.description && <NoteText text={event.description} className="mt-3 text-[13px]" />}
        {event.stage === 'cancelled' && event.cancel_reason && (
          <p className="mt-3 text-[12.5px] text-muted">{t('event.cancelledBecause')}: {event.cancel_reason}</p>
        )}

        {error && <div className="mt-3"><ErrorState message={error} /></div>}

        {live && (
          <div className="mt-3 flex flex-wrap gap-2">
            {event.stage === 'idea' && (
              <Button size="sm" variant="primary" onClick={() => setConfirming(true)} disabled={pending}>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                {t('event.confirm')}
              </Button>
            )}
            {/* Done goes with the results: Sales'. */}
            {!limited && event.stage === 'confirmed' && (
              <Button size="sm" variant="success" onClick={() => setFinishing(true)} disabled={pending}>
                <Check className="h-3.5 w-3.5" aria-hidden />
                {t('event.markDone')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setCancelling(true)} disabled={pending}>
              <Ban className="h-3.5 w-3.5" aria-hidden />
              {t('event.cancel')}
            </Button>
            {event.stage === 'idea' && (
              <Button size="sm" variant="ghost" onClick={() => setRemoving(true)} disabled={pending}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t('event.deleteIdea')}
              </Button>
            )}
          </div>
        )}
      </Card>

      {(event.stage === 'done' || hasResults(event)) && (
        <div className="mb-4">
          <ResultsCard event={event} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {!limited && <Tasks event={event} tasks={tasks} people={choices.people} today={today} live={live} />}
          {!limited && <ContactsCard event={event} contacts={contacts} today={today} />}
          <Staff event={event} shifts={shifts} staff={staff} live={live} />
          <NotesCard event={event} notes={notes} />
        </div>
        <div className="space-y-4">
          <EventProducts event={event} order={order} products={products} returns={returns} catalog={catalog} methods={methods} />
          {!limited && <Budget event={event} costs={costs} costTypes={costTypes} />}
          <FilesCard event={event} files={files} />
        </div>
      </div>

      {editing && <EventDialog event={event} choices={choices} today={today} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => run(() => confirmEvent(event.id), () => setConfirming(false))}
        title={t('event.confirm')}
        message={
          event.owner_id
            ? [
                t('event.confirmBody', { name: event.owner_name ?? '' }),
                products.length > 0 &&
                  t('event.confirmOrder', { count: products.length, date: formatDate(deliveryDateOf(event, null), 'weekday') }),
              ].filter(Boolean).join(' ')
            : t('event.errOwnerRequired')
        }
        confirmLabel={t('event.confirm')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
      {finishing && <ResultsDialog event={event} markDone onClose={() => setFinishing(false)} />}
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={() => {
          setError(null);
          startTransition(async () => {
            const res = await deleteIdea(event.id);
            setRemoving(false);
            if (!res.ok) return setError(labels.error(res.error));
            router.push('/events');
          });
        }}
        title={t('event.deleteIdea')}
        message={t('event.deleteIdeaBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
      {cancelling && (
        <CancelDialog
          eventId={event.id}
          order={order?.status === 'confirmed' ? order : null}
          onClose={() => setCancelling(false)}
        />
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[12px] text-muted sm:pt-px">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function CancelDialog({ eventId, order, onClose }: { eventId: string; order: EventOrder | null; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!reason.trim()) return;
    startTransition(async () => {
      const res = await cancelEvent(eventId, reason);
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('event.cancel')}
      description={t('event.cancelBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.back')}</Button>
          <Button variant="danger" onClick={submit} loading={pending} disabled={!reason.trim()}>{t('event.cancel')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {order && (
          <p className={cn('text-[12.5px] font-medium', order.shipped_at ? 'text-warn' : 'text-fg')}>
            {order.shipped_at
              ? t('event.cancelOrderKept', { reference: order.reference })
              : t('event.cancelOrderToo', { reference: order.reference })}
          </p>
        )}
        <Field label={t('event.cancelReason')} required htmlFor="event-cancel-reason">
          <NoteTextarea id="event-cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </div>
    </Dialog>
  );
}

/* --------------------------------- tasks --------------------------------- */

function Tasks({
  event,
  tasks,
  people,
  today,
  live,
}: {
  event: EventRow;
  tasks: SalesActivity[];
  people: { id: string; name: string }[];
  today: string;
  live: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [editing, setEditing] = useState<SalesActivity | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? '—';
  const open = tasks.filter((a) => a.status === 'planned').length;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(labels.error(res.error ?? ''));
      router.refresh();
    });
  };

  return (
    <Section
      title={`${t('event.tasks')}${tasks.length ? ` · ${tasks.length - open}/${tasks.length}` : ''}`}
      action={
        live && (
          <Button size="sm" variant="ghost" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('event.addTask')}
          </Button>
        )
      }
    >
      {error && <div className="mb-2"><ErrorState message={error} /></div>}
      {tasks.length === 0 ? (
        <p className="text-[12.5px] text-muted">{event.stage === 'idea' ? t('event.tasksNoneIdea') : t('event.tasksNone')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((a) => {
            const late = a.status === 'planned' && a.activity_date < today;
            return (
              <li key={a.id} className="flex items-start gap-2 py-1.5">
                {a.status === 'planned' ? (
                  <button
                    type="button"
                    aria-label={t('event.taskDone')}
                    title={t('event.taskDone')}
                    disabled={pending}
                    onClick={() => act(() => recordActivity({ activity_id: a.id, status: 'done' }))}
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border border-muted hover:border-accent hover:bg-accent/10"
                  />
                ) : (
                  <span className={cn('mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded', a.status === 'done' ? 'bg-done text-white' : 'bg-surface-2 text-muted')}>
                    {a.status === 'done' ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn('break-words text-[13px]', a.status !== 'planned' && 'text-muted line-through')}>{a.title}</p>
                  <p className="text-[12px] text-muted">
                    <span className={cn('tabular', late && 'font-semibold text-late')}>{formatDate(a.activity_date, 'weekday')}</span>
                    {' · '}
                    {personName(a.salesperson_id)}
                  </p>
                </div>
                {a.status === 'planned' && (
                  <>
                    <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(a)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={t('common.delete')} disabled={pending} onClick={() => act(() => removeActivity(a.id))}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <TaskDialog
          event={event}
          task={editing === 'new' ? null : editing}
          people={people}
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  );
}

function TaskDialog({
  event,
  task,
  people,
  onClose,
}: {
  event: EventRow;
  task: SalesActivity | null;
  people: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [title, setTitle] = useState(task?.title ?? '');
  const [date, setDate] = useState(task?.activity_date ?? event.start_date);
  const [personId, setPersonId] = useState(task?.salesperson_id ?? event.owner_id ?? people[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = !!title.trim() && !!date && !!personId;

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const input = { event_id: event.id, title, activity_date: date, salesperson_id: personId };
      const res = task ? await updateEventTask(task.id, input) : await addEventTask(input);
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={task ? t('event.editTask') : t('event.addTask')}
      description={t('event.taskHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('event.taskTitle')} required htmlFor="event-task-title">
          <Input id="event-task-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('event.taskBy')} required htmlFor="event-task-date">
            <Input id="event-task-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('event.taskWho')} required htmlFor="event-task-who">
            <Select id="event-task-who" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------------- staff --------------------------------- */

function Staff({ event, shifts, staff, live }: { event: EventRow; shifts: EventShift[]; staff: StaffCandidate[]; live: boolean }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const days = [...new Set(shifts.map((s) => s.shift_date))];

  return (
    <Section
      title={t('event.staff')}
      action={
        live && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('event.addShift')}
          </Button>
        )
      }
    >
      {error && <div className="mb-2"><ErrorState message={error} /></div>}
      {shifts.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t('event.staffNone')}</p>
      ) : (
        <div className="space-y-2">
          {days.map((day) => (
            <div key={day}>
              <p className="text-[12px] font-semibold tabular">{formatDate(day, 'weekday')}</p>
              <ul>
                {shifts.filter((s) => s.shift_date === day).map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-0.5 text-[13px]">
                    <span className="w-24 shrink-0 tabular text-muted">{timeRange(s.start_time, s.end_time) ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {s.person_name}
                      {s.hr_worker_id && <Badge tone="neutral" className="ml-1.5">{t('event.noAccount')}</Badge>}
                      {s.note && <span className="ml-1.5 text-[12px] text-muted">{s.note}</span>}
                    </span>
                    {live && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('common.delete')}
                        disabled={pending}
                        onClick={() => {
                          setError(null);
                          startTransition(async () => {
                            const res = await removeShift(s.id, event.id);
                            if (!res.ok) return setError(labels.error(res.error));
                            router.refresh();
                          });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {adding && <ShiftDialog event={event} staff={staff} onClose={() => setAdding(false)} />}
    </Section>
  );
}

function ShiftDialog({ event, staff, onClose }: { event: EventRow; staff: StaffCandidate[]; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [person, setPerson] = useState<string | null>(null);
  const [date, setDate] = useState(event.start_date);
  const [from, setFrom] = useState(event.open_time?.slice(0, 5) ?? '');
  const [until, setUntil] = useState(event.close_time?.slice(0, 5) ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = staff.find((s) => `${s.kind}:${s.id}` === person);
  const ready = !!chosen && !!date && (!until || (!!from && until > from));

  function submit() {
    if (!chosen) return;
    setError(null);
    startTransition(async () => {
      const res = await addShift({
        event_id: event.id,
        shift_date: date,
        start_time: from || null,
        end_time: until || null,
        person: { kind: chosen.kind, id: chosen.id },
        note,
      });
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('event.addShift')}
      description={t('event.shiftHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('event.shiftWho')} required htmlFor="event-shift-who">
          <Combobox
            id="event-shift-who"
            items={staff}
            value={person}
            onChange={setPerson}
            getKey={(s) => `${s.kind}:${s.id}`}
            getLabel={(s) => s.name}
            getSearchText={(s) => s.name}
            renderOption={(s) => (
              <span className="flex items-center gap-1.5">
                {s.name}
                {s.kind === 'worker' && <Badge tone="neutral">{t('event.noAccount')}</Badge>}
              </span>
            )}
          />
        </Field>
        <Field label={t('event.shiftDay')} required htmlFor="event-shift-day">
          <Input id="event-shift-day" type="date" min={event.start_date} max={event.end_date} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('event.shiftFrom')} htmlFor="event-shift-from">
            <Input id="event-shift-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('event.shiftUntil')} htmlFor="event-shift-until">
            <Input id="event-shift-until" type="time" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        </div>
        <Field label={t('event.shiftNote')} htmlFor="event-shift-note">
          <Input id="event-shift-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* --------------------------------- budget -------------------------------- */

function Budget({ event, costs, costTypes }: { event: EventRow; costs: EventCost[]; costTypes: EventListEntry[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [editing, setEditing] = useState<EventCost | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sum = (key: 'planned_amount' | 'actual_amount') => costs.reduce((n, c) => n + (c[key] ?? 0), 0);
  const anyActual = costs.some((c) => c.actual_amount !== null);

  return (
    <Section
      title={t('event.budget')}
      action={
        event.stage !== 'cancelled' && (
          <Button size="sm" variant="ghost" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('event.addCost')}
          </Button>
        )
      }
    >
      {error && <div className="mb-2"><ErrorState message={error} /></div>}
      {costs.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t('event.budgetNone')}</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] text-muted">
              <th className="py-1 font-medium">{t('event.costType')}</th>
              <th className="py-1 text-right font-medium">{t('event.planned')}</th>
              <th className="py-1 text-right font-medium">{t('event.actual')}</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {costs.map((c) => (
              <tr key={c.id}>
                <td className="py-1.5 pr-2">
                  {labels.entry(costTypes, c.type_id)}
                  {c.description && <span className="block text-[12px] text-muted">{c.description}</span>}
                </td>
                <td className="py-1.5 text-right tabular">{chf(c.planned_amount)}</td>
                <td className="py-1.5 text-right tabular">{chf(c.actual_amount)}</td>
                <td className="py-1 text-right">
                  <span className="inline-flex">
                    <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(c)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('common.delete')}
                      disabled={pending}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const res = await removeCost(c.id, event.id);
                          if (!res.ok) return setError(labels.error(res.error));
                          router.refresh();
                        });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-1.5">{t('event.total')}</td>
              <td className="py-1.5 text-right tabular">{chf(sum('planned_amount'))}</td>
              <td className="py-1.5 text-right tabular">{anyActual ? chf(sum('actual_amount')) : '—'}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
      {editing && (
        <CostDialog event={event} cost={editing === 'new' ? null : editing} costTypes={costTypes} onClose={() => setEditing(null)} />
      )}
    </Section>
  );
}

function CostDialog({
  event,
  cost,
  costTypes,
  onClose,
}: {
  event: EventRow;
  cost: EventCost | null;
  costTypes: EventListEntry[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const types = costTypes.filter((c) => c.is_active || c.id === cost?.type_id);
  const [typeId, setTypeId] = useState(cost?.type_id ?? types[0]?.id ?? '');
  const [description, setDescription] = useState(cost?.description ?? '');
  const [planned, setPlanned] = useState(cost?.planned_amount?.toString() ?? '');
  const [actual, setActual] = useState(cost?.actual_amount?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amount = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const valid = (v: string) => v.trim() === '' || (Number.isFinite(amount(v)) && amount(v)! >= 0);
  const ready = !!typeId && valid(planned) && valid(actual);

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await saveCost(
        { event_id: event.id, type_id: typeId, description, planned_amount: amount(planned), actual_amount: amount(actual) },
        cost?.id,
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
      title={cost ? t('event.editCost') : t('event.addCost')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('event.costType')} required htmlFor="event-cost-type">
          <Select id="event-cost-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} autoFocus>
            {types.map((c) => <option key={c.id} value={c.id}>{localizedName(c, locale)}</option>)}
          </Select>
        </Field>
        <Field label={t('event.costDescription')} htmlFor="event-cost-description">
          <Input id="event-cost-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('event.planned')} (CHF)`} htmlFor="event-cost-planned">
            <Input id="event-cost-planned" inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} />
          </Field>
          <Field label={`${t('event.actual')} (CHF)`} htmlFor="event-cost-actual">
            <Input id="event-cost-actual" inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
