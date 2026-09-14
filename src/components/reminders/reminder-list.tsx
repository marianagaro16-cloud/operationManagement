'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ListTodo, Search } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { EmptyState, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { LINK_TYPES } from '@/domain/reminders/links';
import { REMINDER_VIEWS, type Reminder, type ReminderFilters, type ReminderView } from '@/types/reminders';
import { ReminderCard } from './reminder-card';
import { QuickReminderButton } from './reminder-actions';
import { PushBlockedNotice } from './reminder-bits';

const VIEW_KEY: Record<ReminderView, MessageKey> = {
  today: 'reminder.viewToday',
  upcoming: 'reminder.viewUpcoming',
  overdue: 'reminder.viewOverdue',
  shared: 'reminder.viewShared',
  completed: 'reminder.viewCompleted',
  cancelled: 'reminder.viewCancelled',
};

const EMPTY_KEY: Record<ReminderView, MessageKey> = {
  today: 'reminder.emptyToday',
  upcoming: 'reminder.emptyUpcoming',
  overdue: 'reminder.emptyOverdue',
  shared: 'reminder.emptyShared',
  completed: 'reminder.emptyCompleted',
  cancelled: 'reminder.emptyCancelled',
};

/** Every filter lives in the URL, so a view can be reloaded, shared and gone back to. */
export function reminderHref(filters: Partial<ReminderFilters>): string {
  const params = new URLSearchParams();
  if (filters.view && filters.view !== 'today') params.set('view', filters.view);
  if (filters.q) params.set('q', filters.q);
  if (filters.link) params.set('link', filters.link);
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.creator) params.set('creator', filters.creator);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const qs = params.toString();
  return qs ? `/reminders?${qs}` : '/reminders';
}

export function ReminderList({
  rows,
  total,
  pageSize,
  filters,
  counts,
  viewerId,
  nowIso,
}: {
  rows: Reminder[];
  total: number;
  pageSize: number;
  filters: ReminderFilters;
  /** Open counts for the tabs that need attention. */
  counts: { today: number; overdue: number };
  viewerId: string;
  nowIso: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(filters.q ?? '');
  const first = useRef(true);

  // Debounced: the search runs on the server, and a query per keystroke is
  // wasted work on a phone connection.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const handle = setTimeout(() => {
      router.replace(reminderHref({ ...filters, q: q.trim() || undefined, page: 1 }));
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const set = (patch: Partial<ReminderFilters>) => router.push(reminderHref({ ...filters, ...patch, page: 1 }));
  const hasFilters = Boolean(filters.q || filters.link || filters.scope || filters.creator || filters.from || filters.to);
  const shown = Math.min(total, filters.page * pageSize);
  const firstShown = (filters.page - 1) * pageSize + 1;

  return (
    <>
      <PageHeader
        title={t('reminder.title')}
        subtitle={t('reminder.subtitle')}
        action={<QuickReminderButton viewerId={viewerId} variant="primary" size="md" />}
      />

      <PushBlockedNotice />

      {/* Views, then personal tasks as a sibling tab: the two lists a person
          works from, side by side, and never mixed. */}
      <nav className="-mx-4 mb-3 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1 border-b border-border pb-px">
          {REMINDER_VIEWS.map((view) => {
            const count = view === 'today' ? counts.today : view === 'overdue' ? counts.overdue : 0;
            return (
              <li key={view}>
                <Link
                  href={reminderHref({ ...filters, view, page: 1 })}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                    filters.view === view ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
                  )}
                >
                  {t(VIEW_KEY[view])}
                  {count > 0 && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-[11px] tabular',
                        view === 'overdue' ? 'bg-late/15 text-late' : 'bg-accent/15 text-accent',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href="/reminders/tasks"
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                pathname === '/reminders/tasks' ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              <ListTodo className="h-3.5 w-3.5" aria-hidden />
              {t('reminder.personalTasksTab')}
            </Link>
          </li>
        </ul>
      </nav>

      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('reminder.search')}
            aria-label={t('reminder.search')}
            className="pl-9"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Select value={filters.scope ?? ''} onChange={(e) => set({ scope: (e.target.value || undefined) as ReminderFilters['scope'] })} aria-label={t('reminder.filterAnyScope')}>
            <option value="">{t('reminder.filterAnyScope')}</option>
            <option value="personal">{t('reminder.filterPersonal')}</option>
            <option value="shared">{t('reminder.filterShared')}</option>
          </Select>
          <Select value={filters.creator ?? ''} onChange={(e) => set({ creator: (e.target.value || undefined) as ReminderFilters['creator'] })} aria-label={t('reminder.filterAnyCreator')}>
            <option value="">{t('reminder.filterAnyCreator')}</option>
            <option value="me">{t('reminder.filterMine')}</option>
            <option value="others">{t('reminder.filterOthers')}</option>
          </Select>
          <Select value={filters.link ?? ''} onChange={(e) => set({ link: e.target.value || undefined })} aria-label={t('reminder.filterAnyLink')} className="col-span-2 lg:col-span-1">
            <option value="">{t('reminder.filterAnyLink')}</option>
            <option value="none">{t('reminder.filterNoLink')}</option>
            {LINK_TYPES.map((type) => (
              <option key={type} value={type}>{t(`reminder.linkType.${type}` as MessageKey)}</option>
            ))}
          </Select>
          <Input type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} aria-label={t('reminder.filterFrom')} title={t('reminder.filterFrom')} />
          <Input type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} aria-label={t('reminder.filterTo')} title={t('reminder.filterTo')} />
        </div>

        {hasFilters && (
          <Link
            href={reminderHref({ view: filters.view })}
            onClick={() => setQ('')}
            className="inline-block text-[12px] font-medium text-muted hover:text-fg"
          >
            {t('reminder.clearFilters')}
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? t('reminder.noMatches') : t(EMPTY_KEY[filters.view])}
          body={hasFilters ? undefined : t('reminder.emptyBody')}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <ReminderCard reminder={r} viewerId={viewerId} nowIso={nowIso} />
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between gap-2 text-[12px] text-muted">
            <span className="tabular">
              {t('reminder.countOf', { shown: `${firstShown}–${shown}`, total })}
            </span>
            <span className="flex gap-1.5">
              {filters.page > 1 && (
                <Link
                  href={reminderHref({ ...filters, page: filters.page - 1 })}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 font-medium text-fg hover:bg-surface-2"
                  aria-label={t('calendar.prev')}
                >
                  ‹
                </Link>
              )}
              {shown < total && (
                <Link
                  href={reminderHref({ ...filters, page: filters.page + 1 })}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 font-medium text-fg hover:bg-surface-2"
                >
                  {t('reminder.loadMore')}
                </Link>
              )}
            </span>
          </div>
        </>
      )}
    </>
  );
}
