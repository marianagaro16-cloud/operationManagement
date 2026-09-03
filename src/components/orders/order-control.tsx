'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/shell/app-shell';
import { lineProgress, orderProgress, toQuantity } from '@/domain/orders/progress';
import { isBeforeGoLive } from '@/domain/orders/config';
import { BUSINESS_TZ } from '@/lib/datetime';
import { customerLabel, productLabel, type Customer, type DeliveryMethod, type Order, type Product } from '@/types/orders';
import { OrderDialog } from './order-dialog';
import { UrgencyBadge } from './urgency-badge';

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
  orders,
  customers,
  products,
  deliveryMethods,
  month,
  filters,
  isAdmin,
}: {
  orders: Order[];
  customers: Customer[];
  products: Product[];
  deliveryMethods: DeliveryMethod[];
  month: string;
  filters: { customerId?: string; deliveryMethodId?: string; status?: string };
  isAdmin: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Order | null>(null);
  const [creating, setCreating] = useState(false);

  const anchor = DateTime.fromISO(`${month}-01`, { zone: BUSINESS_TZ });
  const shiftMonth = (delta: number) => anchor.plus({ months: delta }).toFormat('yyyy-MM');

  // DAY -> CUSTOMER -> orders. Orders are never merged: two orders from one
  // customer on one day stay distinct rows for traceability.
  const byDay = new Map<string, Map<string, Order[]>>();
  for (const o of orders) {
    let day = byDay.get(o.delivery_date);
    if (!day) { day = new Map(); byDay.set(o.delivery_date, day); }
    const list = day.get(o.customer.name);
    if (list) list.push(o);
    else day.set(o.customer.name, [o]);
  }

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams();
    params.set('month', month);
    if (filters.customerId) params.set('customer', filters.customerId);
    if (filters.deliveryMethodId) params.set('method', filters.deliveryMethodId);
    if (filters.status) params.set('status', filters.status);
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/orders?${params.toString()}`);
  };

  return (
    <>
      <PageHeader
        title={t('orders.title')}
        subtitle={t('orders.subtitle')}
        action={
          isAdmin ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('orders.newOrder')}
            </Button>
          ) : undefined
        }
      />

      {/* Month navigation + filters */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-1">
          {/* Months before go-live hold no data — that history lives in Excel,
              so navigating there would look like data loss. */}
          {isBeforeGoLive(shiftMonth(-1)) ? (
            <span className="inline-flex h-9 w-9 items-center justify-center text-subtle opacity-40">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </span>
          ) : (
            <Link
              href={`/orders?month=${shiftMonth(-1)}`}
              aria-label={t('calendar.prev')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <span className="min-w-[150px] text-center text-[14px] font-semibold capitalize">
            {formatDate(`${month}-01`, 'monthYear')}
          </span>
          <Link
            href={`/orders?month=${shiftMonth(1)}`}
            aria-label={t('calendar.next')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {/* Searchable: 216 customers is far too many to scroll. An empty
              field means "all", which is why clearing it removes the filter. */}
          <Combobox
            items={customers}
            value={filters.customerId ?? null}
            onChange={(id) => setFilter('customer', id ?? '')}
            getKey={(c) => c.id}
            getLabel={customerLabel}
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
          <Select
            value={filters.status ?? ''}
            onChange={(e) => setFilter('status', e.target.value)}
            aria-label={t('orders.orderStatus')}
          >
            <option value="">{t('orders.allStatuses')}</option>
            <option value="draft">{t('orders.statusDraft')}</option>
            <option value="confirmed">{t('orders.statusConfirmed')}</option>
            <option value="cancelled">{t('orders.statusCancelled')}</option>
          </Select>
        </div>
      </div>

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
                          isAdmin={isAdmin}
                          onEdit={() => setEditing(order)}
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
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function OrderCard({
  order,
  isAdmin,
  onEdit,
}: {
  order: Order;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const { t, formatDate } = useI18n();
  const progress = orderProgress(
    order.lines.map((l) => ({
      ordered_quantity: l.ordered_quantity,
      shortfall_reason: l.shortfall_reason,
      allocations: l.allocations,
    })),
  );

  const cancelled = order.status === 'cancelled';

  return (
    <Card className={cn(cancelled && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2">
        <span className="text-[12px] font-medium tabular text-muted">#{order.reference}</span>
        {order.delivery_method && <Badge tone="neutral">{order.delivery_method.name}</Badge>}
        {order.order_type === 'sample' && <Badge tone="accent">{t('orders.typeSample')}</Badge>}
        {order.status === 'draft' && <Badge tone="warn">{t('orders.statusDraft')}</Badge>}
        {cancelled && <Badge tone="late">{t('orders.statusCancelled')}</Badge>}
        {!cancelled && progress.isComplete && <Badge tone="done">{t('prep.statusComplete')}</Badge>}
        {!cancelled && progress.hasUnexplainedShortfall && (
          <Badge tone="warn">{t('prep.statusPartial')}</Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Countdown to the committed delivery hour, if there is one. */}
          {!cancelled && (
            <UrgencyBadge
              deliveryDate={order.delivery_date}
              deliveryTime={order.delivery_time}
              isComplete={progress.isComplete}
            />
          )}
          {/* Delivery date leads here; preparation date is exposed alongside. */}
          <span className="text-[11.5px] text-muted">
            {t('orders.preparationOn', { date: formatDate(order.preparation_date, 'short') })}
          </span>
          {isAdmin && (
            <Button size="icon" variant="ghost" onClick={onEdit} aria-label={t('common.edit')}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {order.note && (
        <p className="border-b border-border bg-surface-2/50 px-3.5 py-1.5 text-[12.5px] text-muted">
          {order.note}
        </p>
      )}

      <ul className="divide-y divide-border">
        {order.lines.map((line) => {
          const p = lineProgress(line.ordered_quantity, line.allocations, line.shortfall_reason);
          return (
            <li key={line.id} className="flex items-center gap-3 px-3.5 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {productLabel(line.product)}
              </span>
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
    </Card>
  );
}
