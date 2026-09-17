'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Truck,
} from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { weekDays } from '@/domain/orders/scheduling';
import { orderStage, stageWeight } from '@/domain/orders/stage';
import { addDays } from '@/lib/datetime';
import { setOrdersShipped } from '@/server/order-actions';
import type { OrderWithProgress } from '@/types/orders';
import {
  CustomerTypeBadge,
  OrderPreparationCard,
  type BulkToggle,
} from './preparation-view';
import { useOrderError } from './order-fulfilment';
import { BoxTypesProvider } from './order-boxes';
import type { BoxType } from '@/types/orders';

export type OrdersTab = 'to_prepare' | 'ready' | 'shipped' | 'all';
export type OrdersMode = 'preparation' | 'delivery';

/** Every link in the section keeps the tab, day and date mode together. */
export function ordersHref(tab: OrdersTab, date?: string, mode?: OrdersMode, extra = ''): string {
  const params = new URLSearchParams({ tab });
  if (date) params.set('date', date);
  if (mode && mode !== 'preparation') params.set('mode', mode);
  const qs = params.toString();
  return `/orders?${qs}${extra}`;
}

const TAB_KEY: Record<OrdersTab, MessageKey> = {
  to_prepare: 'orders.tabToPrepare',
  ready: 'orders.tabReady',
  shipped: 'orders.tabShipped',
  all: 'orders.tabAll',
};

/**
 * The tabs of the Orders section.
 *
 * Shared by the board (the three stage tabs) and by Order Control (the
 * managers' "All" tab), so moving between them is one row of links rather
 * than two screens that do not know about each other.
 */
export function OrdersTabs({
  active,
  counts,
  canManage,
  date,
  mode,
}: {
  active: OrdersTab;
  counts?: Partial<Record<OrdersTab, number>>;
  canManage: boolean;
  date?: string;
  mode?: OrdersMode;
}) {
  const { t } = useI18n();
  const tabs: OrdersTab[] = canManage ? ['to_prepare', 'ready', 'shipped', 'all'] : ['to_prepare', 'ready', 'shipped'];
  return (
    <nav className="-mx-4 mb-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1 border-b border-border pb-px">
        {tabs.map((tab) => {
          const count = counts?.[tab];
          return (
            <li key={tab}>
              <Link
                href={tab === 'all' ? '/orders?tab=all' : ordersHref(tab, date, mode)}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors',
                  active === tab ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
                )}
              >
                {t(TAB_KEY[tab])}
                {count !== undefined && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11px] tabular',
                      active === tab ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted',
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The Orders section: To prepare · Ready · Shipped.
 *
 * One place for the order's whole day on the floor — what still has to be
 * prepared, what is prepared and waiting to leave, what has left — replacing
 * the separate Preparation screen. Lots are recorded inside each order on the
 * To prepare tab, exactly as before.
 *
 * A plain user sees TODAY only, and "today" means everything that still needs
 * something: the day's preparation, unfinished orders from earlier days, and
 * every ready order that has not left, whatever its date. Managers can move
 * between days and switch the day between preparation and delivery date, and
 * have the monthly order book as the All tab.
 */
export function OrdersBoard({
  tab,
  date,
  today,
  mode,
  canManage,
  toPrepare,
  carriedOver,
  ready,
  shipped,
  openDays,
  boxTypes,
}: {
  tab: Exclude<OrdersTab, 'all'>;
  date: string;
  today: string;
  mode: OrdersMode;
  canManage: boolean;
  toPrepare: OrderWithProgress[];
  carriedOver: OrderWithProgress[];
  ready: OrderWithProgress[];
  shipped: OrderWithProgress[];
  openDays: string[];
  /** Active box types, for recording boxes on the cards. */
  boxTypes: BoxType[];
}) {
  const { t, formatDate } = useI18n();
  const [bulk, setBulk] = useState<BulkToggle>(null);

  const counts = { to_prepare: toPrepare.length + carriedOver.length, ready: ready.length, shipped: shipped.length };
  const visibleCount = tab === 'to_prepare' ? counts.to_prepare : tab === 'ready' ? counts.ready : counts.shipped;

  return (
    <BoxTypesProvider boxTypes={boxTypes}>
      <PageHeader title={t('orders.title')} subtitle={t('orders.boardSubtitle')} />

      <OrdersTabs active={tab} counts={counts} canManage={canManage} date={canManage ? date : undefined} mode={mode} />

      {canManage ? (
        <DayNavigation tab={tab} date={date} today={today} mode={mode} openDays={openDays} />
      ) : (
        // A plain user works today; there is nothing to navigate.
        <p className="mb-3 text-[13px] font-medium capitalize">{formatDate(today, 'weekday')}</p>
      )}

      {visibleCount > 0 && tab !== 'shipped' && (
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

      {tab === 'to_prepare' && (
        <ToPrepareTab
          toPrepare={toPrepare}
          carriedOver={carriedOver}
          mode={mode}
          canManage={canManage}
          bulk={bulk}
        />
      )}
      {tab === 'ready' && <ReadyTab orders={ready} canManage={canManage} bulk={bulk} showsBacklog={date === today} />}
      {tab === 'shipped' && <ShippedTab orders={shipped} canManage={canManage} />}
    </BoxTypesProvider>
  );
}

/* ------------------------------ navigation ------------------------------ */

function DayNavigation({
  tab,
  date,
  today,
  mode,
  openDays,
}: {
  tab: Exclude<OrdersTab, 'all'>;
  date: string;
  today: string;
  mode: OrdersMode;
  openDays: string[];
}) {
  const { t, formatDate } = useI18n();
  const days = weekDays(date);
  const open = new Set(openDays);

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Which date the day is keyed on. Preparation is the floor's view;
            delivery is what leaves that day. */}
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-[12.5px]">
          {(['preparation', 'delivery'] as const).map((m) => (
            <Link
              key={m}
              href={ordersHref(tab, date, m)}
              className={cn(
                'rounded-md px-2.5 py-1 font-medium transition-colors',
                mode === m ? 'bg-accent/10 text-accent' : 'text-muted hover:text-fg',
              )}
            >
              {t(m === 'preparation' ? 'orders.modePreparation' : 'orders.modeDelivery')}
            </Link>
          ))}
        </div>
        {date !== today && (
          <Link href={ordersHref(tab, today, mode)} className="text-[12.5px] font-medium text-accent hover:underline">
            {t('orders.backToToday')}
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Link
          href={ordersHref(tab, addDays(date, -7), mode)}
          aria-label={t('calendar.prev')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1">
          {days.map((d) => (
            <Link
              key={d}
              href={ordersHref(tab, d, mode)}
              className={cn(
                'flex min-w-[52px] flex-1 flex-col items-center rounded-lg border px-1.5 py-1.5 text-center transition-colors',
                d === date ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-muted hover:text-fg',
              )}
            >
              <span className="text-[10.5px] font-medium uppercase">{formatDate(d, 'weekday').split(' ')[0].slice(0, 3)}</span>
              <span className="text-[13px] font-semibold tabular">{d.slice(8)}</span>
              <span className={cn('mt-0.5 h-1 w-1 rounded-full', open.has(d) ? 'bg-warn' : 'bg-transparent')} aria-hidden />
              {open.has(d) && <span className="sr-only">{t('prep.openWork')}</span>}
            </Link>
          ))}
        </div>
        <Link
          href={ordersHref(tab, addDays(date, 7), mode)}
          aria-label={t('calendar.next')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------ to prepare ------------------------------ */

function byCustomer(orders: OrderWithProgress[]) {
  // Work already started first; within that, reference order.
  const sorted = [...orders].sort((a, b) => stageWeight(orderStage(a)) - stageWeight(orderStage(b)));
  const groups = new Map<string, OrderWithProgress[]>();
  for (const o of sorted) {
    const list = groups.get(o.customer.name);
    if (list) list.push(o);
    else groups.set(o.customer.name, [o]);
  }
  return [...groups.entries()];
}

function ToPrepareTab({
  toPrepare,
  carriedOver,
  mode,
  canManage,
  bulk,
}: {
  toPrepare: OrderWithProgress[];
  carriedOver: OrderWithProgress[];
  mode: OrdersMode;
  canManage: boolean;
  bulk: BulkToggle;
}) {
  const { t, formatDate } = useI18n();

  if (toPrepare.length === 0 && carriedOver.length === 0) {
    return <EmptyState title={t('orders.emptyToPrepare')} body={t('orders.emptyToPrepareBody')} />;
  }

  return (
    <div className="space-y-6">
      {/* Above the day's own work: something already late outranks something
          merely due. Each card names the day it was scheduled for. */}
      {carriedOver.length > 0 && (
        <section>
          <div className="mb-2 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.06] px-3.5 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">
                {t('prep.carriedOver')}
                <span className="ml-1.5 tabular text-warn">{carriedOver.length}</span>
              </p>
              <p className="text-[12.5px] text-muted">{t('prep.carriedOverBody')}</p>
            </div>
          </div>
          <div className="space-y-3">
            {carriedOver.map((order) => (
              <div key={order.id}>
                <h3 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px] font-medium">
                  {order.customer.name}
                  <CustomerTypeBadge type={order.customer.customer_type} />
                  <span className="text-[12px] font-normal text-warn">
                    {mode === 'delivery'
                      ? t('orders.deliveryOn', { date: formatDate(order.delivery_date, 'short') })
                      : t('orders.preparationOn', { date: formatDate(order.preparation_date, 'short') })}
                  </span>
                </h3>
                <OrderPreparationCard order={order} canManage={canManage} bulk={bulk} />
              </div>
            ))}
          </div>
        </section>
      )}

      {byCustomer(toPrepare).map(([customerName, orders]) => (
        <section key={customerName}>
          <h2 className="mb-2 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            {customerName}
            <CustomerTypeBadge type={orders[0].customer.customer_type} />
          </h2>
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderPreparationCard key={order.id} order={order} canManage={canManage} bulk={bulk} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* --------------------------------- ready -------------------------------- */

/**
 * Grouped by delivery method, because that is how orders leave: the DHL
 * orders go together, the Planzer ones together. Each group can be selected
 * as a whole and marked Shipped in one press.
 */
function byMethod(orders: OrderWithProgress[]) {
  const groups = new Map<string, { name: string; orders: OrderWithProgress[] }>();
  for (const o of orders) {
    const key = o.delivery_method?.id ?? 'none';
    const group = groups.get(key) ?? { name: o.delivery_method?.name ?? '—', orders: [] };
    group.orders.push(o);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      name: g.name,
      orders: g.orders.sort(
        (a, b) => a.delivery_date.localeCompare(b.delivery_date) || a.reference - b.reference,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function ReadyTab({
  orders,
  canManage,
  bulk,
  showsBacklog,
}: {
  orders: OrderWithProgress[];
  canManage: boolean;
  bulk: BulkToggle;
  showsBacklog: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translate = useOrderError();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const groups = useMemo(() => byMethod(orders), [orders]);

  // Only ids still on the tab count — a refresh may have removed some.
  const chosen = orders.filter((o) => selected.has(o.id)).map((o) => o.id);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (ids: string[]) =>
    setSelected((cur) => {
      const next = new Set(cur);
      const all = ids.every((id) => next.has(id));
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });

  function shipSelected() {
    setError(null);
    startTransition(async () => {
      const res = await setOrdersShipped(chosen, true);
      if (!res.ok) { setError(translate(res.error)); return; }
      setSelected(new Set());
      router.refresh();
    });
  }

  if (orders.length === 0) {
    return <EmptyState title={t('orders.emptyReady')} body={t('orders.emptyReadyBody')} />;
  }

  return (
    <div className="space-y-6 pb-20">
      {showsBacklog && <p className="text-[12.5px] text-muted">{t('orders.readyBacklogHint')}</p>}

      {groups.map((group) => {
        const ids = group.orders.map((o) => o.id);
        const allChosen = ids.every((id) => selected.has(id));
        return (
          <section key={group.key}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <Truck className="h-4 w-4 text-muted" aria-hidden />
                {group.name}
                <span className="text-[12.5px] font-normal tabular text-muted">{group.orders.length}</span>
              </h2>
              <Button size="sm" variant="ghost" onClick={() => toggleGroup(ids)}>
                {allChosen ? t('orders.selectNone') : t('orders.selectAll')}
              </Button>
            </div>
            <div className="space-y-3">
              {group.orders.map((order) => (
                <div key={order.id}>
                  <p className="mb-1 flex flex-wrap items-center gap-x-2 text-[13.5px] font-medium">
                    {order.customer.name}
                    <CustomerTypeBadge type={order.customer.customer_type} />
                  </p>
                  <OrderPreparationCard
                    order={order}
                    canManage={canManage}
                    bulk={bulk}
                    selection={{ checked: selected.has(order.id), onToggle: () => toggle(order.id) }}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* The bulk action stays in reach while scrolling through the groups. */}
      {chosen.length > 0 && (
        <div className="sticky bottom-20 z-10 md:bottom-4">
          {error && <div className="mb-2"><ErrorState message={error} /></div>}
          <Button variant="primary" size="lg" className="w-full justify-center shadow-pop" onClick={shipSelected} loading={pending}>
            <Truck className="h-4 w-4" aria-hidden />
            {t('orders.markSelectedShipped', { count: chosen.length })}
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- shipped ------------------------------- */

function ShippedTab({ orders, canManage }: { orders: OrderWithProgress[]; canManage: boolean }) {
  const { t } = useI18n();
  const groups = useMemo(() => byMethod(orders), [orders]);
  // Shipped work is a record: every card starts folded.
  const folded = useMemo<BulkToggle>(() => ({ expanded: false }), []);

  if (orders.length === 0) {
    return <EmptyState title={t('orders.emptyShipped')} body={t('orders.emptyShippedBody')} />;
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
            <Truck className="h-4 w-4 text-muted" aria-hidden />
            {group.name}
            <span className="text-[12.5px] font-normal tabular text-muted">{group.orders.length}</span>
          </h2>
          <div className="space-y-3">
            {group.orders.map((order) => (
              <div key={order.id}>
                <p className="mb-1 text-[13.5px] font-medium text-muted">{order.customer.name}</p>
                <OrderPreparationCard order={order} canManage={canManage} bulk={folded} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
