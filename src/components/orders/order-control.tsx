'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Pencil, Plus, Search, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Input, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { StatusChip } from '@/components/ui/status-chip';
import { OrderTypeBadge } from '@/components/orders/order-type-badge';
import { PageHeader } from '@/components/shell/app-shell';
import { lineProgress, toQuantity } from '@/domain/orders/progress';
import { ORDERS_GO_LIVE } from '@/domain/orders/config';
import { periodLabel, periodRange, shiftCustomRange, shiftPeriod, type PeriodRange } from '@/domain/orders/reporting';
import { businessToday } from '@/lib/datetime';
import { productLabel, type Brand, type Customer, type DeliveryMethod, type OrderWithProgress, type Product } from '@/types/orders';
import { IncidentDialog, orderContextFrom } from '@/components/incidents/incident-dialog';
import type { IncidentCategory, IncidentType } from '@/types/incidents';
import { OrderDialog } from './order-dialog';
import { UrgencyBadge } from './urgency-badge';
import { NoteBlock, NoteChip } from '@/components/ui/note';
import { OrderStageChip } from './order-fulfilment';
import { OrderWeight } from './order-weight';
import type { BulkToggle } from './preparation-view';

/** The periods the book can show, as in the reports minus Year. */
const BOOK_PERIODS = ['day', 'week', 'month', 'custom'] as const;
type BookPeriod = (typeof BOOK_PERIODS)[number];

/**
 * Order Control — replaces the monthly "Control de pedidos" workbook.
 *
 * A modern grouped list rather than a 261-column grid. The month is a filter
 * over one orders table, not a separate sheet per month, so searching across
 * history is a query rather than opening a file.
 *
 * Grouping mirrors the operational workflow: DAY -> CUSTOMER -> PRODUCTS.
 */
export function OrderControl({
  tabs,
  orders,
  customers,
  products,
  deliveryMethods,
  brands,
  range,
  anchor,
  filters,
  canManage,
  currentUserName,
  incidentCategories,
  incidentTypes,
  canReportIncident,
}: {
  /** The Orders section tabs, shown under the heading. */
  tabs?: ReactNode;
  orders: OrderWithProgress[];
  customers: Customer[];
  products: Product[];
  deliveryMethods: DeliveryMethod[];
  brands: Brand[];
  /** The delivery dates shown: a day, a week, a month or a range. */
  range: PeriodRange;
  /** A date inside the period, which the arrows and period buttons move from. */
  anchor: string;
  filters: {
    customerId?: string;
    deliveryMethodId?: string;
    status?: string;
    /** Orders carrying at least one line of this brand. */
    brandId?: string;
    /** Free text. When set, the search spans every month, not just this one. */
    query?: string;
  };
  canManage: boolean;
  /** Named in the new-order dialog as the person creating it. */
  currentUserName: string;
  /** The incident vocabulary, for reporting one straight from a row. */
  incidentCategories: IncidentCategory[];
  incidentTypes: IncidentType[];
  canReportIncident: boolean;
}) {
  const { t, formatDate, locale } = useI18n();
  const router = useRouter();
  const hasRange = range.kind === 'custom';
  const [draftFrom, setDraftFrom] = useState(range.start);
  const [draftTo, setDraftTo] = useState(range.end);
  const [editing, setEditing] = useState<OrderWithProgress | null>(null);
  const [creating, setCreating] = useState(false);
  // One dialog for the whole list, exactly as the editor is — not one per card.
  const [reporting, setReporting] = useState<OrderWithProgress | null>(null);
  const [draftQuery, setDraftQuery] = useState(filters.query ?? '');
  // The last Expand all / Collapse all press; each card starts open.
  const [bulk, setBulk] = useState<BulkToggle>(null);

  /**
   * A link to the book for a period, keeping the filters unless told not to.
   * Custom ranges carry from/to; the other periods carry a date inside them.
   */
  const bookHref = (
    next: { period: BookPeriod; date?: string; from?: string; to?: string },
    keepFilters = true,
  ) => {
    const params = new URLSearchParams();
    params.set('tab', 'all');
    params.set('period', next.period);
    if (next.period === 'custom') {
      params.set('from', next.from ?? range.start);
      params.set('to', next.to ?? range.end);
    } else {
      params.set('date', next.date ?? anchor);
    }
    if (keepFilters) {
      if (filters.customerId) params.set('customer', filters.customerId);
      if (filters.deliveryMethodId) params.set('method', filters.deliveryMethodId);
      if (filters.status) params.set('status', filters.status);
      if (filters.brandId) params.set('brand', filters.brandId);
      if (filters.query) params.set('q', filters.query);
    }
    return `/orders?${params.toString()}`;
  };

  // The arrows move by the period itself; a range slides by its own length.
  const stepHref = (delta: number) => {
    if (hasRange) {
      const r = shiftCustomRange(range, delta);
      return { href: bookHref({ period: 'custom', from: r.start, to: r.end }), end: r.end };
    }
    const date = shiftPeriod(range.kind, anchor, delta);
    return { href: bookHref({ period: range.kind as BookPeriod, date }), end: periodRange(range.kind, date).end };
  };
  const prev = stepHref(-1);
  const next = stepHref(1);

  // DAY -> CUSTOMER -> orders. Orders are never merged: two orders from one
  // customer on one day stay distinct rows for traceability.
  const byDay = new Map<string, Map<string, OrderWithProgress[]>>();
  for (const o of orders) {
    let day = byDay.get(o.delivery_date);
    if (!day) { day = new Map(); byDay.set(o.delivery_date, day); }
    const list = day.get(o.customer.name);
    if (list) list.push(o);
    else day.set(o.customer.name, [o]);
  }

  const setFilter = (key: string, value: string) => {
    // Removing the range chip goes back to the book's default: today.
    const base = key === 'range'
      ? bookHref({ period: 'day', date: businessToday() })
      : bookHref(hasRange ? { period: 'custom' } : { period: range.kind as BookPeriod });
    const params = new URLSearchParams(base.split('?')[1]);
    if (key !== 'range') {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/orders?${params.toString()}`);
  };

  const applyRange = () => {
    if (!draftFrom || !draftTo) return;
    router.push(bookHref({ period: 'custom', from: draftFrom, to: draftTo }));
  };

  // What is currently narrowing the list, as removable chips.
  //
  // The filters lived in the URL already — which is right — but nothing said
  // they were on and nothing cleared them, so a customer filter left from a
  // previous visit made a month look empty.
  const activeFilters = [
    filters.query && {
      key: 'q',
      label: `"${filters.query}"`,
    },
    hasRange && {
      key: 'range',
      label: periodLabel(range, locale),
    },
    filters.customerId && {
      key: 'customer',
      label: customers.find((c) => c.id === filters.customerId)?.name ?? t('orders.customer'),
    },
    filters.deliveryMethodId && {
      key: 'method',
      label:
        deliveryMethods.find((m) => m.id === filters.deliveryMethodId)?.name ??
        t('orders.deliveryMethod'),
    },
    filters.brandId && {
      key: 'brand',
      label: brands.find((b) => b.id === filters.brandId)?.name ?? t('master.brand'),
    },
    filters.status && {
      key: 'status',
      label: t(
        filters.status === 'draft' ? 'orders.statusDraft'
          : filters.status === 'confirmed' ? 'orders.statusConfirmed'
            : filters.status === 'ready' ? 'orders.stageReady'
              : filters.status === 'shipped' ? 'orders.stageShipped'
                : 'orders.statusCancelled',
      ),
    },
  ].filter(Boolean) as { key: string; label: string }[];

  return (
    <>
      <PageHeader
        title={t('orders.title')}
        subtitle={t('orders.subtitle')}
        action={
          canManage ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('orders.newOrder')}
            </Button>
          ) : undefined
        }
      />

      {tabs}

      {/* Month navigation + filters */}
      <div className="mb-4 space-y-2">
        {/* Free text across every month. Submitted rather than typed-through,
            because a query widens the query window to the whole go-live range
            and firing that on each keystroke would be wasteful. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilter('q', draftQuery.trim());
          }}
          className="relative"
        >
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <Input
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            placeholder={t('orders.searchOrders')}
            aria-label={t('orders.searchOrders')}
            className="pl-9"
          />
        </form>

        {/* Day, week, month or range — the same periods as the reports. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {BOOK_PERIODS.map((p) => (
            <Link
              key={p}
              href={p === 'custom' ? bookHref({ period: 'custom', from: range.start, to: range.end }) : bookHref({ period: p })}
              aria-current={range.kind === p ? 'true' : undefined}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                range.kind === p
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-surface text-muted hover:text-fg',
              )}
            >
              {t(`report.period${p[0].toUpperCase()}${p.slice(1)}` as 'report.periodDay')}
            </Link>
          ))}
        </div>

        {filters.query && !hasRange && (
          <p className="text-[12px] text-muted">
            {t('orders.searchAcrossMonths', { count: orders.length })}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {/* Periods before go-live hold no data — that history lives in
              Excel, so navigating there would look like data loss. */}
          {prev.end < ORDERS_GO_LIVE ? (
            <span className="inline-flex h-9 w-9 items-center justify-center text-subtle opacity-40">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </span>
          ) : (
            <Link
              href={prev.href}
              aria-label={t('calendar.prev')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <span className="min-w-[150px] text-center text-[14px] font-semibold capitalize">
            {periodLabel(range, locale)}
          </span>
          <Link
            href={next.href}
            aria-label={t('calendar.next')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>

        </div>

        {/* Delivery-date range, for spans that are not a day, week or month. */}
        {hasRange && (
          <form
            onSubmit={(e) => { e.preventDefault(); applyRange(); }}
            className="ml-auto flex flex-wrap items-center gap-1.5"
          >
            <Input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              aria-label={t('report.from')}
              className="w-auto"
            />
            <span className="text-[13px] text-subtle">–</span>
            <Input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              aria-label={t('report.to')}
              className="w-auto"
            />
            <Button type="submit" disabled={!draftFrom || !draftTo}>
              {t('report.apply')}
            </Button>
          </form>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {/* Searchable: 216 customers is far too many to scroll. An empty
              field means "all", which is why clearing it removes the filter. */}
          <Combobox
            items={customers}
            value={filters.customerId ?? null}
            onChange={(id) => setFilter('customer', id ?? '')}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => `${c.company_name} ${c.company_name_addition ?? ''}`}
            placeholder={t('orders.allCustomers')}
            emptyMessage={t('orders.noCustomersFound')}
            renderOption={(c) => (
              <span className="block">
                <span className="block truncate">{c.company_name}</span>
                {c.company_name_addition && (
                  <span className="block truncate text-[11.5px] text-muted">
                    {c.company_name_addition}
                  </span>
                )}
              </span>
            )}
          />
          <Select
            value={filters.deliveryMethodId ?? ''}
            onChange={(e) => setFilter('method', e.target.value)}
            aria-label={t('orders.deliveryMethod')}
          >
            <option value="">{t('orders.allMethods')}</option>
            {deliveryMethods.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
          {/* Our own brands, so a plain select — there are four of them and
              they are not going to become two hundred. */}
          <Select
            value={filters.brandId ?? ''}
            onChange={(e) => setFilter('brand', e.target.value)}
            aria-label={t('master.brand')}
          >
            <option value="">{t('master.allBrands')}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
          <Select
            value={filters.status ?? ''}
            onChange={(e) => setFilter('status', e.target.value)}
            aria-label={t('orders.orderStatus')}
          >
            <option value="">{t('orders.allStatuses')}</option>
            <option value="draft">{t('orders.statusDraft')}</option>
            <option value="confirmed">{t('orders.statusConfirmed')}</option>
            <option value="cancelled">{t('orders.statusCancelled')}</option>
            <option value="ready">{t('orders.stageReady')}</option>
            <option value="shipped">{t('orders.stageShipped')}</option>
          </Select>
        </div>

        {/* Removable chips + one clear, matching the inventory screen. */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {activeFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  if (f.key === 'q') setDraftQuery('');
                  if (f.key === 'range') { setDraftFrom(''); setDraftTo(''); }
                  setFilter(f.key, '');
                }}
                className="inline-flex items-center gap-1 rounded-md border border-accent/25 bg-accent/[0.08] px-2 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-accent/15"
              >
                {f.label}
                <X className="h-3 w-3" aria-hidden />
              </button>
            ))}
            <Link
              href={bookHref(hasRange ? { period: 'custom' } : { period: range.kind as BookPeriod }, false)}
              onClick={() => { setDraftQuery(''); setDraftFrom(''); setDraftTo(''); }}
              className="px-1.5 py-1 text-[12px] font-medium text-muted transition-colors hover:text-fg"
            >
              {t('inventory.clearFilters')}
            </Link>
          </div>
        )}
      </div>

      {orders.length > 0 && (
        <div className="mb-3 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setBulk({ expanded: true })}>
            <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
            {t('prep.expandAll')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBulk({ expanded: false })}>
            <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />
            {t('prep.collapseAll')}
          </Button>
        </div>
      )}

      {orders.length === 0 ? (
        <EmptyState title={t('orders.noOrders')} body={t('orders.noOrdersBody')} />
      ) : (
        <div className="space-y-6">
          {[...byDay.entries()].map(([day, customersOnDay]) => (
            <section key={day}>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
                {formatDate(day, 'weekday')}
              </h2>
              <div className="space-y-3">
                {[...customersOnDay.entries()].map(([customerName, list]) => (
                  <div key={customerName}>
                    <h3 className="mb-1 text-[13.5px] font-medium">{customerName}</h3>
                    <div className="space-y-2">
                      {list.map((order) => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          canManage={canManage}
                          bulk={bulk}
                          onEdit={() => setEditing(order)}
                          onReportIncident={
                            canReportIncident ? () => setReporting(order) : undefined
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <OrderDialog
          key={editing?.id ?? 'new'}
          order={editing}
          customers={customers}
          products={products}
          deliveryMethods={deliveryMethods}
          currentUserName={currentUserName}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); router.refresh(); }}
        />
      )}

      {/* The same dialog the order page raises, fed from the row that was
          clicked — so the customer, the dates and the order's own products are
          already filled in and nothing is retyped. */}
      {reporting && (
        <IncidentDialog
          key={reporting.id}
          customers={customers}
          products={products}
          categories={incidentCategories}
          types={incidentTypes}
          order={orderContextFrom(reporting)}
          onClose={() => setReporting(null)}
          onSaved={(id) => { setReporting(null); router.push(`/incidents/${id}`); }}
        />
      )}
    </>
  );
}

function OrderCard({
  order,
  canManage,
  bulk,
  onEdit,
  onReportIncident,
}: {
  order: OrderWithProgress;
  canManage: boolean;
  /** The last Expand all / Collapse all press, applied when it changes. */
  bulk: BulkToggle;
  onEdit: () => void;
  /** Absent when the viewer may not report one, which removes the button. */
  onReportIncident?: () => void;
}) {
  const { t, formatDate } = useI18n();
  // Computed once by the query layer; see OrderWithProgress.
  const progress = order.progress;

  const cancelled = order.status === 'cancelled';

  // Open by default, as the book always showed its products. Folding keeps
  // the header — reference, badges, weight — and the order note.
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (bulk) setExpanded(bulk.expanded);
  }, [bulk]);

  return (
    <Card className={cn(cancelled && 'opacity-60')}>
      <div
        className={cn(
          'flex cursor-pointer flex-wrap items-center gap-2 px-3.5 py-2',
          (expanded || order.note) && 'border-b border-border',
        )}
        // The whole header toggles, except the links and buttons inside it.
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('a, button, input, label')) setExpanded((v) => !v);
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? t('prep.collapse') : t('prep.expand')}
          className="-ml-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', !expanded && '-rotate-90')} aria-hidden />
        </button>
        {/* The reference is the order's address, not a caption. */}
        <Link
          href={`/orders/${order.id}`}
          className="text-[12px] font-medium tabular text-muted transition-colors hover:text-accent hover:underline"
          title={t('orders.openOrder')}
        >
          #{order.reference}
        </Link>
        {order.delivery_method && <Badge tone="neutral">{order.delivery_method.name}</Badge>}
        {/* A sample, a replacement and a sponsorship are not sales. Saying so
            on the row is what stops a month of giveaways reading as a month
            of trade. */}
        <OrderTypeBadge type={order.order_type} />
        {/* Provenance. A generated order used to be indistinguishable from a
            hand-typed one, so a draft gave the reviewer nothing to review. */}
        {order.generated_from_template_id && (
          <Badge tone="neutral">{t('orders.fromTemplate')}</Badge>
        )}
        {/* Label and tone both come from STATUS_PRESENTATION, so an order
            status and an inventory status can no longer be tinted by two
            independent decisions that happen to agree. */}
        <OrderStageChip order={order} />
                {!cancelled && progress.hasUnexplainedShortfall && (
          <StatusChip domain="line" status="partial" />
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Countdown to the committed delivery hour, if there is one. */}
          {!cancelled && (
            <UrgencyBadge
              deliveryDate={order.delivery_date}
              deliveryTime={order.delivery_time}
              isComplete={Boolean(order.ready_at)}
            />
          )}
          <OrderWeight order={order} icon showBoxes className="text-[11.5px] text-muted" />
          {/* Delivery date leads here; preparation date is exposed alongside —
              and links to the day it lands on, which the route has always
              accepted as a parameter and nothing ever pointed at. */}
          <Link
            href={`/orders?tab=to_prepare&date=${order.preparation_date}`}
            className="text-[11.5px] text-muted transition-colors hover:text-accent hover:underline"
            title={t('orders.openPreparationDay')}
          >
            {t('orders.preparationOn', { date: formatDate(order.preparation_date, 'short') })}
          </Link>
          {/* Reporting an incident starts here as often as it starts on the
              order's own page — this list is what somebody has open when a
              customer rings about a delivery. Hidden on a cancelled order:
              nothing can have gone wrong with a delivery that was not made. */}
          {onReportIncident && !cancelled && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onReportIncident}
              aria-label={t('incident.reportForOrder')}
              title={t('incident.reportForOrder')}
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
          {/* A ready or shipped order is edited by reopening it first. */}
          {canManage && !order.ready_at && (
            <Button size="icon" variant="ghost" onClick={onEdit} aria-label={t('common.edit')}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {order.note && (
        <NoteBlock className={cn('px-3.5 py-1.5', expanded && 'border-b border-border')}>{order.note}</NoteBlock>
      )}

      {expanded && (
      <ul className="divide-y divide-border">
        {order.lines.map((line) => {
          const p = lineProgress(line.ordered_quantity, line.allocations, line);
          // Only a genuine divergence is worth showing. A null proposal means
          // the line was typed by hand, or predates provenance being recorded
          // — neither is "changed", so neither gets a marker.
          const proposed =
            line.generated_quantity === null ? null : toQuantity(line.generated_quantity);
          const diverged = proposed !== null && proposed !== toQuantity(line.ordered_quantity);
          return (
            <li key={line.id} className="flex items-center gap-3 px-3.5 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {productLabel(line.product)}
                {line.note && <NoteChip className="ml-2">{line.note}</NoteChip>}
              </span>
              {diverged && (
                <span
                  className="shrink-0 text-[11.5px] tabular text-muted"
                  title={t('orders.proposedQuantity', { qty: proposed })}
                >
                  {t('orders.proposedQuantity', { qty: proposed })}
                </span>
              )}
              <span className="shrink-0 text-[13px] font-medium tabular">
                {toQuantity(line.ordered_quantity)}
              </span>
              {p.allocated > 0 && (
                <span
                  className={cn(
                    'shrink-0 text-[11.5px] tabular',
                    p.status === 'complete' ? 'text-done' : 'text-warn',
                  )}
                >
                  {t('prep.progress', { allocated: p.allocated, ordered: p.ordered })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      )}
    </Card>
  );
}
