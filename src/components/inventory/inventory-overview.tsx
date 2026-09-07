'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ClipboardList, Filter, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, Checkbox, EmptyState, Field, Input, SectionHeading, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { localizedTitle } from '@/lib/localized-content';
import { AssigneeList, DigitalPendingBadge, StatusBadge, WeekBadge } from './inventory-bits';
import type { InventoryListRow, InventoryStatus } from '@/types/inventory';
import type { Profile } from '@/types/database';

export interface OverviewData {
  today: string;
  dueToday: InventoryListRow[];
  overdue: InventoryListRow[];
  upcoming: InventoryListRow[];
  needsReview: InventoryListRow[];
  digitalPending: InventoryListRow[];
  history: InventoryListRow[];
  historyTotal: number;
}

/**
 * The inventory overview.
 *
 * Ordered by what needs doing rather than by date: overdue and today first,
 * then what an admin owes (digital values, unreviewed differences), then the
 * forward view, and history last behind filters. History is paged server-side
 * — it grows forever and is never loaded whole.
 */
export function InventoryOverview({
  data,
  templates,
  users,
  isAdmin,
}: {
  data: OverviewData;
  templates: { id: string; name: string; translations: unknown }[];
  users: Profile[];
  isAdmin: boolean;
}) {
  const { t } = useI18n();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const params = useSearchParams();

  const hasFilters = ['template', 'status', 'week', 'from', 'to', 'user', 'pending', 'review'].some(
    (k) => params.get(k),
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('inventory.title')} subtitle={t('inventory.subtitle')} />

      {data.overdue.length > 0 && (
        <Section title={t('inventory.overdue')} rows={data.overdue} today={data.today} tone="late" />
      )}

      <Section
        title={t('inventory.dueToday')}
        rows={data.dueToday}
        today={data.today}
        emptyBody={t('inventory.emptyToday')}
        showEmpty
      />

      {/* Admin-owed work. A regular user cannot act on either of these, so the
          sections are theirs alone rather than noise on everyone's screen. */}
      {isAdmin && data.needsReview.length > 0 && (
        <Section title={t('inventory.needsReview')} rows={data.needsReview} today={data.today} tone="late" />
      )}
      {isAdmin && data.digitalPending.length > 0 && (
        <Section title={t('inventory.digitalPendingList')} rows={data.digitalPending} today={data.today} tone="warn" />
      )}

      {data.upcoming.length > 0 && (
        <Section title={t('inventory.upcoming')} rows={data.upcoming} today={data.today} />
      )}

      {/* ------------------------------ history ------------------------------ */}
      <div>
        <SectionHeading
          title={t('inventory.history')}
          subtitle={t('inventory.itemsCounted', { count: data.historyTotal })}
          action={
            <Button
              size="sm"
              variant={hasFilters ? 'primary' : 'ghost'}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <Filter className="h-3.5 w-3.5" aria-hidden />
              {t('inventory.filters')}
            </Button>
          }
        />

        {(filtersOpen || hasFilters) && (
          <FilterPanel templates={templates} users={users} onClose={() => setFiltersOpen(false)} />
        )}

        {data.history.length === 0 ? (
          <EmptyState
            title={t('inventory.emptyHistory')}
            icon={<ClipboardList className="h-5 w-5" aria-hidden />}
          />
        ) : (
          <>
            <ul className="space-y-2">
              {data.history.map((row) => (
                <InventoryRow key={row.id} row={row} today={data.today} />
              ))}
            </ul>
            {data.history.length < data.historyTotal && <LoadMore current={data.history.length} />}
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  rows,
  today,
  tone,
  emptyBody,
  showEmpty,
}: {
  title: string;
  rows: InventoryListRow[];
  today: string;
  tone?: 'late' | 'warn';
  emptyBody?: string;
  showEmpty?: boolean;
}) {
  if (rows.length === 0 && !showEmpty) return null;
  return (
    <div>
      <SectionHeading title={title} />
      {rows.length === 0 ? (
        <EmptyState title={emptyBody ?? ''} icon={<ClipboardList className="h-5 w-5" aria-hidden />} />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <InventoryRow key={row.id} row={row} today={today} tone={tone} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InventoryRow({
  row,
  today,
  tone,
}: {
  row: InventoryListRow;
  today: string;
  tone?: 'late' | 'warn';
}) {
  const { t, locale, formatDate } = useI18n();

  // The instance carries a frozen name so a renamed template does not rewrite
  // history; the live template is used only to translate the current name.
  const name = row.template
    ? localizedTitle(
        { title: row.template.name, translations: row.template.translations as never },
        locale,
      )
    : row.name_snapshot;

  return (
    <li>
      <Link
        href={`/inventory/${row.id}`}
        className={cn(
          'block rounded-xl border bg-surface p-3 shadow-card transition-colors hover:bg-surface-2/50 sm:p-3.5',
          tone === 'late' ? 'border-late/30' : tone === 'warn' ? 'border-warn/30' : 'border-border',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium leading-snug">{name}</p>
            <p className="mt-0.5 text-[12px] text-muted">
              {formatDate(row.inventory_date, 'medium')}
              {row.inventory_date === today && ` · ${t('common.today')}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <WeekBadge isoWeek={row.iso_week} />
            <StatusBadge status={row.status} />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <AssigneeList people={row.assignees} />
          {row.digital_pending_count > 0 && <DigitalPendingBadge count={row.digital_pending_count} />}
          {row.review_count > 0 && (
            <span className="text-[12px] font-medium text-late">
              {t('inventory.reviewCount', { count: row.review_count })}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

/* ------------------------------- filters ------------------------------- */

/**
 * Filters live in the URL, not in component state: a filtered history view is
 * something people share ("look at KW 37") and come back to, and the server
 * needs them anyway to page the query.
 */
function FilterPanel({
  templates,
  users,
  onClose,
}: {
  templates: { id: string; name: string; translations: unknown }[];
  users: Profile[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    // A changed filter always restarts paging; keeping the old offset would
    // silently show page 3 of a different result set.
    next.delete('take');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const statuses: InventoryStatus[] = ['in_progress', 'completed', 'to_review', 'resolved'];

  return (
    <Card className="mb-3 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('inventory.type')}>
          <Select value={params.get('template') ?? ''} onChange={(e) => set('template', e.target.value)}>
            <option value="">{t('inventory.filterAll')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {localizedTitle({ title: tpl.name, translations: tpl.translations as never }, locale)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('common.filter')}>
          <Select value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('inventory.filterAll')}</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {t(
                  s === 'in_progress'
                    ? 'inventory.statusInProgress'
                    : s === 'completed'
                      ? 'inventory.statusCompleted'
                      : s === 'to_review'
                        ? 'inventory.statusToReview'
                        : 'inventory.statusResolved',
                )}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('inventory.week')}>
          <Input
            type="number"
            min={1}
            max={53}
            inputMode="numeric"
            placeholder="37"
            defaultValue={params.get('week') ?? ''}
            onBlur={(e) => set('week', e.target.value)}
          />
        </Field>

        <Field label={t('inventory.filterUser')}>
          <Select value={params.get('user') ?? ''} onChange={(e) => set('user', e.target.value)}>
            <option value="">{t('inventory.filterAll')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('inventory.filterFrom')}>
          <Input
            type="date"
            defaultValue={params.get('from') ?? ''}
            onChange={(e) => set('from', e.target.value)}
          />
        </Field>

        <Field label={t('inventory.filterTo')}>
          <Input
            type="date"
            defaultValue={params.get('to') ?? ''}
            onChange={(e) => set('to', e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-3 space-y-2">
        <Checkbox
          label={t('inventory.filterDigitalPending')}
          checked={params.get('pending') === '1'}
          onChange={(e) => set('pending', e.target.checked ? '1' : null)}
        />
        <Checkbox
          label={t('inventory.filterNeedsReview')}
          checked={params.get('review') === '1'}
          onChange={(e) => set('review', e.target.checked ? '1' : null)}
        />
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          loading={pending}
          onClick={() => {
            startTransition(() => router.replace(pathname, { scroll: false }));
            onClose();
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          {t('inventory.clearFilters')}
        </Button>
      </div>
    </Card>
  );
}

function LoadMore({ current }: { current: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-3 flex justify-center">
      <Button
        size="sm"
        loading={pending}
        onClick={() => {
          const next = new URLSearchParams(params.toString());
          next.set('take', String(current + 25));
          startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
        }}
      >
        {t('inventory.loadMore')}
      </Button>
    </div>
  );
}
