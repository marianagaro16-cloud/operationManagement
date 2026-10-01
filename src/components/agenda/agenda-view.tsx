'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import {
  BellRing, Boxes, Check, ChevronLeft, ChevronRight, ClipboardList, Handshake, ListTodo, Plane, Plus, Receipt, ShieldCheck, Users, X,
} from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { localizedName, localizedTitle, type TranslatableContent } from '@/lib/localized-content';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, ErrorState, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { completeOccurrence } from '@/server/actions';
import { ProductionDialog } from '@/components/tasks/production-dialog';
import { setPersonalTaskStatus } from '@/server/reminder-actions';
import { answerMeeting } from '@/server/meeting-actions';
import type { AgendaItem, AgendaKind } from '@/types/agenda';
import type { ActivityKind } from '@/types/sales';
import { ReminderDialog } from '@/components/reminders/reminder-dialog';
import { PersonalTaskDialog } from '@/components/reminders/personal-tasks';
import { MeetingDialog } from '@/components/meetings/meeting-dialog';

const ICON: Record<AgendaKind, typeof Check> = {
  activity: ClipboardList,
  inventory: Boxes,
  sales: Handshake,
  meeting: Users,
  coverage: ShieldCheck,
  absence: Plane,
  reminder: BellRing,
  personal: ListTodo,
  collection: Receipt,
};

const TONE: Record<AgendaKind, string> = {
  activity: 'border-l-accent',
  inventory: 'border-l-accent',
  sales: 'border-l-done',
  meeting: 'border-l-warn',
  coverage: 'border-l-warn',
  absence: 'border-l-skipped',
  reminder: 'border-l-subtle',
  personal: 'border-l-subtle',
  collection: 'border-l-late',
};

const weekOf = (date: string) => {
  const monday = DateTime.fromISO(date, { zone: BUSINESS_TZ }).startOf('week');
  return Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }).toISODate()!);
};

/**
 * One person's agenda: everything with a day, from every part of the app, in
 * one week. Quick things are done right here — an activity or a personal task
 * ticked off, a meeting answered; everything else opens its own page.
 */
export function AgendaView({
  items,
  date,
  today,
  personId,
  viewerId,
  people,
  kinds,
  adding,
}: {
  /** Adding from the agenda — only in one's own. */
  adding: { canOrganize: boolean; sales: boolean; everyone: { id: string; name: string }[] } | null;
  items: AgendaItem[];
  date: string;
  today: string;
  personId: string;
  viewerId: string;
  /** Whose agenda the viewer may open; empty: only their own. */
  people: { id: string; name: string }[];
  kinds: ActivityKind[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const days = weekOf(date);
  const go = (next: { date?: string; person?: string }) =>
    startNav(() => router.push(`/agenda?date=${next.date ?? date}${(next.person ?? personId) !== viewerId ? `&person=${next.person ?? personId}` : ''}`));
  const shift = (weeks: number) => DateTime.fromISO(date, { zone: BUSINESS_TZ }).plus({ weeks }).toISODate()!;
  const on = (d: string) => items.filter((i) => i.date === d);
  const [creating, setCreating] = useState<{ what: 'reminder' | 'personal' | 'meeting'; date: string } | null>(null);
  const add = (d: string, compact = false) =>
    adding && (
      <AddMenu
        compact={compact}
        canOrganize={adding.canOrganize}
        sales={adding.sales}
        onPick={(what) =>
          what === 'sales' ? router.push(`/sales?tab=planning&date=${d}`) : setCreating({ what, date: d })
        }
      />
    );

  return (
    <div className={cn(navigating && 'opacity-60')}>
      <PageHeader title={t('agenda.title')} subtitle={t('agenda.subtitle')} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="icon" variant="ghost" aria-label={t('calendar.prev')} onClick={() => go({ date: shift(-1) })}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="sm" variant="secondary" onClick={() => go({ date: today })}>{t('calendar.todayCta')}</Button>
        <Button size="icon" variant="ghost" aria-label={t('calendar.next')} onClick={() => go({ date: shift(1) })}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        <span className="text-[13px] font-medium capitalize">
          {formatDate(days[0], 'short')} – {formatDate(days[6], 'short')}
        </span>
        {people.length > 1 && (
          <Select aria-label={t('agenda.whose')} value={personId} onChange={(e) => go({ person: e.target.value })} className="ml-auto w-auto">
            {people.map((p) => <option key={p.id} value={p.id}>{p.id === viewerId ? t('agenda.mine') : p.name}</option>)}
          </Select>
        )}
      </div>

      {/* The computer: the week, side by side. */}
      <div className="hidden grid-cols-7 gap-2 lg:grid">
        {days.map((d) => (
          <div key={d} className={cn('flex min-w-0 flex-col rounded-xl border bg-surface', d === today ? 'border-accent' : 'border-border')}>
            <div className="flex items-center justify-between gap-1 border-b border-border px-2 py-1.5">
              <button type="button" onClick={() => go({ date: d })} className="min-w-0 text-left">
                <span className={cn('block text-[11px] font-medium uppercase', d === today ? 'text-accent' : 'text-muted')}>
                  {formatDate(d, 'weekday').split(/[\s,]/)[0]}
                </span>
                <span className="block text-[15px] font-semibold leading-tight tabular">{formatDate(d, 'short')}</span>
              </button>
              {add(d, true)}
            </div>
            <div className="flex-1 space-y-1.5 p-1.5">
              {on(d).length === 0 && <p className="px-1 py-2 text-center text-[11.5px] text-subtle">—</p>}
              {on(d).map((i) => <Entry key={i.key} item={i} kinds={kinds} compact />)}
            </div>
          </div>
        ))}
      </div>

      {/* The phone: the week as a strip, one day below it. */}
      <div className="space-y-3 lg:hidden">
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => go({ date: d })}
              className={cn(
                'rounded-lg border px-1 py-1.5 text-center',
                d === date ? 'border-accent bg-accent/10' : 'border-border',
              )}
            >
              <span className={cn('block text-[10.5px] uppercase', d === today ? 'font-semibold text-accent' : 'text-muted')}>
                {formatDate(d, 'weekday').split(/[\s,]/)[0].slice(0, 2)}
              </span>
              <span className="block text-[14px] font-semibold tabular">{d.slice(8, 10)}</span>
              <span className="block text-[10px] tabular text-muted">{on(d).length || ''}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold capitalize">{formatDate(date, 'weekday')}</p>
          {add(date)}
        </div>
        {on(date).length === 0 ? (
          <EmptyState title={t('agenda.emptyDay')} />
        ) : (
          <Card className="divide-y divide-border">
            {on(date).map((i) => <Entry key={i.key} item={i} kinds={kinds} />)}
          </Card>
        )}
      </div>

      {creating?.what === 'reminder' && (
        <ReminderDialog
          open
          viewerId={viewerId}
          initialDate={creating.date}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            router.refresh();
          }}
        />
      )}
      {creating?.what === 'personal' && (
        <PersonalTaskDialog task={null} initialTitle="" initialDate={creating.date} onClose={() => setCreating(null)} />
      )}
      {creating?.what === 'meeting' && adding && (
        <MeetingDialog
          meeting={null}
          series={null}
          scope={null}
          people={adding.everyone}
          viewerId={viewerId}
          today={today}
          initialDate={creating.date}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}

/** "+" on a day: a reminder, a personal task, a meeting, or a call or visit. */
function AddMenu({
  canOrganize,
  sales,
  compact,
  onPick,
}: {
  canOrganize: boolean;
  sales: boolean;
  compact: boolean;
  onPick: (what: 'reminder' | 'personal' | 'meeting' | 'sales') => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const options = [
    { what: 'reminder' as const, label: t('agenda.addReminder'), icon: BellRing },
    { what: 'personal' as const, label: t('agenda.addPersonal'), icon: ListTodo },
    ...(canOrganize ? [{ what: 'meeting' as const, label: t('agenda.addMeeting'), icon: Users }] : []),
    ...(sales ? [{ what: 'sales' as const, label: t('agenda.addSales'), icon: Handshake }] : []),
  ];
  return (
    <div className="relative shrink-0">
      <Button
        size={compact ? 'icon' : 'sm'}
        variant={compact ? 'ghost' : 'secondary'}
        className={cn(compact && 'h-7 w-7')}
        aria-label={t('agenda.add')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="h-4 w-4" aria-hidden />
        {!compact && t('agenda.add')}
      </Button>
      {open && (
        <>
          {/* A click anywhere else closes it. */}
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <ul className="absolute right-0 z-40 mt-1 w-48 rounded-lg border border-border bg-surface py-1 shadow-pop">
            {options.map((o) => (
              <li key={o.what}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPick(o.what);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                >
                  <o.icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function Entry({ item: i, kinds, compact = false }: { item: AgendaItem; kinds: ActivityKind[]; compact?: boolean }) {
  const { t, locale, formatDate } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, startTransition] = useTransition();
  const Icon = ICON[i.kind];
  const time = i.start ? (i.end ? `${i.start}–${i.end}` : i.start) : null;
  const kindName = t(`agenda.kind_${i.kind}` as MessageKey);
  const salesKind = i.kind === 'sales' && i.detail ? kinds.find((k) => k.id === i.detail) : undefined;

  // A follow-up: "promise:1250.00" or "follow_up:1250.00".
  const [collectionWhat, collectionOpen] = i.kind === 'collection' && i.detail ? i.detail.split(':') : [null, null];
  const title =
    i.kind === 'absence'
      ? t('agenda.away')
      : i.kind === 'coverage'
        ? t('agenda.covering', { name: i.title })
        : i.translations
          ? localizedTitle({ title: i.title, translations: i.translations } as TranslatableContent, locale)
          : i.title;
  const detail =
    i.kind === 'activity' && i.detail === 'blocked'
      ? t('agenda.blocked')
      : i.kind === 'activity' && i.detail
        ? t('agenda.dueOn', { date: formatDate(i.detail, 'short') })
        : i.kind === 'absence' && i.detail
          ? t(i.detail === 'morning' ? 'absence.morning' : 'absence.afternoon')
          : i.kind === 'meeting' && i.detail === 'cancelled'
            ? t('meeting.cancelled')
            : i.kind === 'collection' && collectionOpen
              ? `${collectionWhat === 'promise' ? t('agenda.checkPromise') : t('agenda.followUpCall')} · CHF ${new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2 }).format(Number(collectionOpen))}`
            : salesKind
              ? localizedName(salesKind, locale)
              : i.kind === 'meeting'
                ? i.detail
                : null;

  const [recording, setRecording] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, hide = true) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error === 'production_record_required') return setRecording(true);
      if (!res.ok) return setError(res.error ?? '');
      if (hide) setGone(true);
      router.refresh();
    });
  };
  const done = i.done || gone;

  const body = (
    <>
      <span className={cn('flex items-center gap-1 font-semibold tabular text-muted', compact ? 'text-[11px]' : 'text-[12px]')}>
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        {time ?? kindName}
        {i.late && !done && <Badge tone="late" className="ml-auto">{t('agenda.late')}</Badge>}
      </span>
      <span className={cn('block break-words font-medium leading-snug', compact ? 'line-clamp-2 text-[12.5px]' : 'text-[13.5px]', done && 'text-muted line-through')}>
        {title}
      </span>
      {detail && <span className="block truncate text-[11.5px] text-muted">{detail}</span>}
    </>
  );

  return (
    <div className={cn('border-l-2', TONE[i.kind], compact ? 'rounded-lg border border-l-2 border-border bg-surface-2/40 px-2 py-1.5' : 'px-3.5 py-2.5')}>
      {i.href ? <Link href={i.href} className="block hover:text-accent">{body}</Link> : <div>{body}</div>}
      {error && <div className="mt-1"><ErrorState message={error} /></div>}
      {recording && <ProductionDialog occurrenceId={i.id} onClose={() => setRecording(false)} onDone={() => setGone(true)} />}
      {!done && i.action === 'complete_activity' && (
        <Button size="sm" variant="secondary" className={cn('mt-1', compact && 'h-6 px-2 text-[11px]')} loading={pending} onClick={() => run(() => completeOccurrence(i.id))}>
          <Check className="h-3 w-3" aria-hidden />
          {t('agenda.markDone')}
        </Button>
      )}
      {!done && i.action === 'complete_personal' && (
        <Button size="sm" variant="secondary" className={cn('mt-1', compact && 'h-6 px-2 text-[11px]')} loading={pending} onClick={() => run(() => setPersonalTaskStatus(i.id, 'completed'))}>
          <Check className="h-3 w-3" aria-hidden />
          {t('agenda.markDone')}
        </Button>
      )}
      {i.action === 'answer_meeting' && (
        <div className="mt-1 flex items-center gap-1">
          <Button
            size="sm"
            variant={i.response === 'yes' ? 'success' : 'secondary'}
            className={cn(compact && 'h-6 px-2 text-[11px]')}
            disabled={pending}
            onClick={() => run(() => answerMeeting(i.id, 'yes', ''), false)}
          >
            <Check className="h-3 w-3" aria-hidden />
            {t('meeting.attend')}
          </Button>
          <Button
            size="sm"
            variant={i.response === 'no' ? 'danger' : 'secondary'}
            className={cn(compact && 'h-6 px-2 text-[11px]')}
            disabled={pending}
            onClick={() => run(() => answerMeeting(i.id, 'no', ''), false)}
          >
            <X className="h-3 w-3" aria-hidden />
            {t('meeting.cannot')}
          </Button>
        </div>
      )}
    </div>
  );
}
