'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PageHeader } from '@/components/shell/app-shell';
import { localizedName } from '@/lib/localized-content';
import { cancelAbsence, decideAbsence } from '@/server/absence-actions';
import type { AbsenceCalendarEntry, AbsenceRow, AbsenceStatus, AbsenceType } from '@/types/absences';
import { AbsenceStatusBadge, useAbsenceLabels } from './absence-parts';
import { AbsenceDialog } from './absence-dialog';

export type AbsenceTab = 'mine' | 'approve' | 'calendar' | 'all';

/**
 * Absences: one's own requests, the ones waiting for a decision (approvers),
 * who is away when (everyone), and every absence with filters (approvers).
 */
export function AbsencesView({
  tab,
  today,
  viewerId,
  approver,
  types,
  mine,
  pending,
  month,
  calendar,
  all,
  people,
}: {
  tab: AbsenceTab;
  today: string;
  viewerId: string;
  approver: boolean;
  types: AbsenceType[];
  mine: AbsenceRow[];
  pending: AbsenceRow[];
  /** The calendar's month, YYYY-MM. */
  month: string;
  calendar: AbsenceCalendarEntry[];
  all: AbsenceRow[];
  people: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const [requesting, setRequesting] = useState(false);
  const tabs = [
    { key: 'mine', label: t('absence.tabMine'), count: 0 },
    ...(approver ? [{ key: 'approve', label: t('absence.tabApprove'), count: pending.length }] : []),
    { key: 'calendar', label: t('absence.tabCalendar'), count: 0 },
    ...(approver ? [{ key: 'all', label: t('absence.tabAll'), count: 0 }] : []),
  ];

  return (
    <>
      <PageHeader
        title={t('absence.navLabel')}
        subtitle={t('absence.subtitle')}
        action={
          <Button variant="primary" size="sm" onClick={() => setRequesting(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('absence.request')}
          </Button>
        }
      />
      <nav className="-mt-2 mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`/absences?tab=${item.key}`}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === item.key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {item.label}
            {item.count > 0 && <span className="ml-1.5 text-[11px] tabular text-warn">{item.count}</span>}
          </Link>
        ))}
      </nav>

      {tab === 'mine' && <AbsenceList rows={mine} types={types} today={today} viewerId={viewerId} approver={approver} showPerson={false} empty={t('absence.mineNone')} />}
      {tab === 'approve' && <ApproveList rows={pending} types={types} />}
      {tab === 'calendar' && <MonthView month={month} entries={calendar} today={today} />}
      {tab === 'all' && (
        <>
          <Filters types={types} people={people} />
          <AbsenceList rows={all} types={types} today={today} viewerId={viewerId} approver={approver} showPerson empty={t('absence.allNone')} />
        </>
      )}

      {requesting && <AbsenceDialog absence={null} types={types} today={today} onClose={() => setRequesting(false)} />}
    </>
  );
}

/* ------------------------------- a list ---------------------------------- */

function AbsenceList({
  rows,
  types,
  today,
  viewerId,
  approver,
  showPerson,
  empty,
}: {
  rows: AbsenceRow[];
  types: AbsenceType[];
  today: string;
  viewerId: string;
  approver: boolean;
  showPerson: boolean;
  empty: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useAbsenceLabels();
  const [editing, setEditing] = useState<AbsenceRow | null>(null);
  const [cancelling, setCancelling] = useState<AbsenceRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) return <EmptyState title={empty} />;

  return (
    <>
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      <Card className="divide-y divide-border">
        {rows.map((a) => {
          const own = a.profile_id === viewerId;
          const canCancel = (own || approver) && (a.status === 'pending' || a.status === 'approved') && a.end_date >= today;
          return (
            <div key={a.id} className="flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {showPerson && <span className="text-[13.5px] font-medium">{a.person_name}</span>}
                  <span className={cn('text-[13.5px]', showPerson ? 'text-muted' : 'font-medium')}>{labels.type(types, a.type_id)}</span>
                  <AbsenceStatusBadge status={a.status} />
                </div>
                <p className="text-[12.5px] tabular">{labels.span(a)}</p>
                {a.note && <p className="text-[12px] text-muted">{a.note}</p>}
                {a.status === 'rejected' && a.rejection_reason && (
                  <p className="text-[12px] text-late">{t('absence.rejectedBecause', { reason: a.rejection_reason })}</p>
                )}
                {(a.status === 'approved' || a.status === 'rejected') && a.decider_name && a.decided_at && (
                  <p className="text-[11.5px] text-muted">
                    {t('absence.decidedBy', { name: a.decider_name, date: formatDate(a.decided_at.slice(0, 10), 'short') })}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-0.5">
                {own && a.status === 'pending' && (
                  <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(a)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
                {canCancel && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(a)} disabled={pending}>
                    {t('absence.cancel')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </Card>
      {editing && <AbsenceDialog absence={editing} types={types} today={today} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={() => {
          const a = cancelling;
          if (!a) return;
          setError(null);
          startTransition(async () => {
            const res = await cancelAbsence(a.id);
            setCancelling(null);
            if (!res.ok) return setError(labels.error(res.error));
            router.refresh();
          });
        }}
        title={t('absence.cancel')}
        message={cancelling ? `${showPerson ? `${cancelling.person_name} · ` : ''}${labels.span(cancelling)}` : ''}
        confirmLabel={t('absence.cancel')}
        cancelLabel={t('common.back')}
        destructive
        loading={pending}
      />
    </>
  );
}

/* ------------------------------- deciding -------------------------------- */

function ApproveList({ rows, types }: { rows: AbsenceRow[]; types: AbsenceType[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useAbsenceLabels();
  const [rejecting, setRejecting] = useState<AbsenceRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decide = (a: AbsenceRow, approve: boolean, why?: string) => {
    setError(null);
    startTransition(async () => {
      const res = await decideAbsence(a.id, approve, why);
      if (!res.ok) return setError(labels.error(res.error));
      setRejecting(null);
      setReason('');
      router.refresh();
    });
  };

  if (rows.length === 0) return <EmptyState title={t('absence.approveNone')} />;

  return (
    <>
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      <Card className="divide-y divide-border">
        {rows.map((a) => (
          <div key={a.id} className="px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[13.5px] font-medium">{a.person_name}</span>
              <span className="text-[13px] text-muted">{labels.type(types, a.type_id)}</span>
            </div>
            <p className="text-[12.5px] tabular">{labels.span(a)}</p>
            {a.note && <p className="text-[12px] text-muted">{a.note}</p>}
            <div className="mt-1.5 flex gap-1.5">
              <Button size="sm" variant="success" onClick={() => decide(a, true)} disabled={pending}>
                <Check className="h-3.5 w-3.5" aria-hidden />
                {t('absence.approve')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(a)} disabled={pending}>
                <X className="h-3.5 w-3.5" aria-hidden />
                {t('absence.reject')}
              </Button>
            </div>
          </div>
        ))}
      </Card>
      {rejecting && (
        <Dialog
          open
          onClose={() => setRejecting(null)}
          title={t('absence.reject')}
          description={`${rejecting.person_name} · ${labels.span(rejecting)}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRejecting(null)} disabled={pending}>{t('common.back')}</Button>
              <Button variant="danger" onClick={() => decide(rejecting, false, reason)} loading={pending} disabled={!reason.trim()}>
                {t('absence.reject')}
              </Button>
            </>
          }
        >
          <Field label={t('absence.rejectReason')} required htmlFor="absence-reject-reason">
            <NoteTextarea id="absence-reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        </Dialog>
      )}
    </>
  );
}

/* ------------------------------- calendar -------------------------------- */

/** Who is away, day by day through a month; today on top. */
function MonthView({ month, entries, today }: { month: string; entries: AbsenceCalendarEntry[]; today: string }) {
  const { t, formatDate, locale } = useI18n();
  const labels = useAbsenceLabels();
  const start = DateTime.fromISO(`${month}-01`, { zone: BUSINESS_TZ });
  const days = Array.from({ length: start.daysInMonth ?? 30 }, (_, i) => start.plus({ days: i }).toISODate()!);
  const on = (d: string) => entries.filter((e) => e.start_date <= d && e.end_date >= d);
  const withSomeone = days.filter((d) => on(d).length > 0);
  const away = on(today);
  const shift = (by: number) => start.plus({ months: by }).toFormat('yyyy-MM');

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('absence.awayToday')}</p>
        {away.length === 0 ? (
          <p className="text-[13px] text-muted">{t('absence.nobodyAway')}</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {away.map((e) => (
              <li key={e.id}>
                <span className="font-medium">{e.person_name}</span>
                {labels.partOn(e, today) && <span className="text-muted"> ({labels.partOn(e, today)})</span>}
                <span className="text-muted"> · {t('absence.backOn', { date: formatDate(e.end_date, 'short') })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Link href={`/absences?tab=calendar&month=${shift(-1)}`} scroll={false} aria-label={t('calendar.prev')} className="rounded-lg p-1.5 hover:bg-surface-2">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <p className="text-[14px] font-semibold capitalize">{start.setLocale(locale).toFormat('LLLL yyyy')}</p>
        <Link href={`/absences?tab=calendar&month=${shift(1)}`} scroll={false} aria-label={t('calendar.next')} className="rounded-lg p-1.5 hover:bg-surface-2">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      {withSomeone.length === 0 ? (
        <EmptyState title={t('absence.monthNone')} />
      ) : (
        <Card className="divide-y divide-border">
          {withSomeone.map((d) => (
            <div key={d} className={cn('flex gap-3 px-3.5 py-2', d === today && 'bg-accent/[0.05]')}>
              <span className={cn('w-24 shrink-0 text-[12.5px] tabular', d === today ? 'font-semibold text-accent' : 'text-muted')}>
                {formatDate(d, 'weekday')}
              </span>
              <span className="min-w-0 flex-1 text-[13px]">
                {on(d).map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && ', '}
                    {e.person_name}
                    {labels.partOn(e, d) && <span className="text-muted"> ({labels.partOn(e, d)})</span>}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* -------------------------------- filters -------------------------------- */

function Filters({ types, people }: { types: AbsenceType[]; people: { id: string; name: string }[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('tab', 'all');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const statuses: AbsenceStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];
  const labels = useAbsenceLabels();

  return (
    <Card className="mb-3 grid gap-3 p-3 sm:grid-cols-5">
      <Field label={t('absence.person')}>
        <Select value={params.get('person') ?? ''} onChange={(e) => set('person', e.target.value)}>
          <option value="">{t('inventory.filterAll')}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label={t('absence.type')}>
        <Select value={params.get('type') ?? ''} onChange={(e) => set('type', e.target.value)}>
          <option value="">{t('inventory.filterAll')}</option>
          {types.map((x) => <option key={x.id} value={x.id}>{localizedName(x, locale)}</option>)}
        </Select>
      </Field>
      <Field label={t('absence.status')}>
        <Select value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">{t('inventory.filterAll')}</option>
          {statuses.map((s) => <option key={s} value={s}>{labels.status(s)}</option>)}
        </Select>
      </Field>
      <Field label={t('absence.from')}>
        <Input type="date" value={params.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} />
      </Field>
      <Field label={t('absence.until')}>
        <Input type="date" value={params.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} />
      </Field>
    </Card>
  );
}
