'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardList, Pencil, Users } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, ReadOnlyNotice, SectionHeading } from '@/components/ui/primitives';
import { StatusChip } from '@/components/ui/status-chip';
import { PageHeader } from '@/components/shell/app-shell';
import { lineProgress, toQuantity } from '@/domain/orders/progress';
import { BUSINESS_TZ } from '@/lib/datetime';
import {
  productLabel,
  type Customer,
  type DeliveryMethod,
  type OrderLine,
  type OrderWithProgress,
  type Product,
} from '@/types/orders';
import { OrderDialog } from './order-dialog';
import { UrgencyBadge } from './urgency-badge';

/**
 * One order, at its own address.
 *
 * Order Control edits an order in a dialog stacked over the month list, which
 * is right for a quick correction and wrong for everything else: a dialog has
 * no URL, so an order could not be linked to, returned to, or opened from a
 * notification. Preparation could show you the reference and never take you
 * to it.
 *
 * This page is the thing those links point at. It does not replace the dialog
 * — the dialog is still how the order is edited, from here as well as from the
 * list — it gives the record somewhere to live.
 *
 * Reading is open to anyone the database already lets read an order, so a
 * person working lot control can open the order they are preparing. EDITING
 * stays behind `orders.manage`, exactly as the pencil in the list does.
 */
export function OrderDetail({
  order,
  customers,
  products,
  deliveryMethods,
  canManage,
  headerAction,
}: {
  order: OrderWithProgress;
  customers: Customer[];
  products: Product[];
  deliveryMethods: DeliveryMethod[];
  canManage: boolean;
  /**
   * An extra action beside Edit — currently "Report incident".
   *
   * Passed in rather than built here so this component keeps knowing nothing
   * about incidents: the order page owns that integration, and an order
   * detail that imported the incident module would couple two modules that
   * only need to meet at one button.
   */
  headerAction?: ReactNode;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const progress = order.progress;
  const cancelled = order.status === 'cancelled';

  // The month this order's delivery falls in, so "all orders for this
  // customer" lands on a page that actually contains this one.
  const month = order.delivery_date.slice(0, 7);

  return (
    <>
      {/* Back to where this most likely came from. The month and customer are
          carried so the list reopens showing this order, not a blank month. */}
      <Link
        href={`/orders?month=${month}`}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('orders.backToOrders')}
      </Link>

      <PageHeader
        title={`#${order.reference}`}
        subtitle={order.customer.name}
        action={
          canManage || headerAction ? (
            // Wraps so the two buttons stack rather than overflow on a phone.
            <div className="flex flex-wrap gap-1.5">
              {headerAction}
              {canManage && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  {t('common.edit')}
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Says why there is no edit button, instead of just not having one.
          Absence of a control reads as a missing feature; this reads as a
          permission, which is what it is. */}
      {!canManage && (
        <ReadOnlyNotice title={t('orders.readOnly')} reason={t('orders.readOnlyBody')} />
      )}

      {/* ------------------------- the facts ------------------------- */}
      <Card className={cn('mb-4 p-3.5', cancelled && 'opacity-70')}>
        <div className="flex flex-wrap items-center gap-1.5">
          {order.status !== 'confirmed' && <StatusChip domain="order" status={order.status} />}
          {!cancelled && progress.isComplete && <StatusChip domain="line" status="complete" />}
          {!cancelled && progress.hasUnexplainedShortfall && (
            <StatusChip domain="line" status="partial" />
          )}
          {order.delivery_method && <Badge tone="neutral">{order.delivery_method.name}</Badge>}
          {order.order_type === 'sample' && <Badge tone="accent">{t('orders.typeSample')}</Badge>}
          {/* A replacement is not a sale. Saying so on the row is what stops
              a month of apologies reading as a month of trade. */}
          {order.order_type === 'replacement' && (
            <Badge tone="warn">{t('orders.typeReplacement')}</Badge>
          )}
          {/* Provenance: a standing order proposed this, a person did not. */}
          {order.generated_from_template_id && (
            <Badge tone="neutral">{t('orders.fromTemplate')}</Badge>
          )}
          {!cancelled && (
            <span className="ml-auto">
              <UrgencyBadge
                deliveryDate={order.delivery_date}
                deliveryTime={order.delivery_time}
                isComplete={progress.isComplete}
              />
            </span>
          )}
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <Fact label={t('orders.customer')}>
            {/* Every other order this customer has in this month. */}
            <Link
              href={`/orders?month=${month}&customer=${order.customer_id}`}
              className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
              title={t('orders.customerOrders')}
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              {order.customer.name}
            </Link>
          </Fact>

          <Fact label={t('orders.deliveryDate')}>
            <span className="tabular">{formatDate(order.delivery_date, 'medium')}</span>
          </Fact>

          <Fact label={t('orders.preparationDate')}>
            {/* The preparation day this order lands on. The route already
                takes exactly this parameter; it simply was never linked. */}
            <Link
              href={`/preparation?date=${order.preparation_date}`}
              className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
              title={t('orders.openPreparationDay')}
            >
              <ClipboardList className="h-3.5 w-3.5" aria-hidden />
              <span className="tabular">{formatDate(order.preparation_date, 'medium')}</span>
            </Link>
          </Fact>

          <Fact label={t('admin.userCreated')}>
            <span className="tabular text-muted">
              {DateTime.fromISO(order.created_at).setZone(BUSINESS_TZ).toFormat('d LLL yyyy')}
            </span>
          </Fact>
        </dl>

        {order.note && (
          <p className="mt-3 rounded-lg bg-surface-2/60 px-3 py-2 text-[12.5px] text-muted">
            {order.note}
          </p>
        )}
      </Card>

      {/* --------------------------- lines --------------------------- */}
      <SectionHeading title={t('orders.linesTitle')} />

      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {order.lines.map((line) => (
            <DetailLine key={line.id} line={line} />
          ))}
        </ul>
      </Card>

      {editing && (
        <OrderDialog
          order={order}
          customers={customers}
          products={products}
          deliveryMethods={deliveryMethods}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-0.5 text-[13.5px]">{children}</dd>
    </div>
  );
}

/**
 * A line with everything recorded against it.
 *
 * Unlike the list card, this shows the individual lot allocations and who
 * entered each one — the author was already being fetched for these rows and
 * then thrown away by every component that rendered them.
 */
function DetailLine({ line }: { line: OrderLine }) {
  const { t, locale } = useI18n();
  const p = lineProgress(line.ordered_quantity, line.allocations, line.shortfall_reason);

  const proposed = line.generated_quantity === null ? null : toQuantity(line.generated_quantity);
  const diverged = proposed !== null && proposed !== toQuantity(line.ordered_quantity);

  return (
    <li className="px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium leading-snug">{productLabel(line.product)}</p>
          {line.product.code && (
            <span className="text-[11px] tabular text-subtle">{line.product.code}</span>
          )}
          {/* What the customer wrote, on an imported line.
              The preview showed this before the order existed; keeping it
              means a line matched to the wrong product can be traced back to
              the text it came from rather than to nothing. */}
          {line.source_text && (
            <p className="mt-0.5 truncate text-[11px] text-subtle" title={line.source_text}>
              {t('import.fromText', { text: line.source_text })}
            </p>
          )}
        </div>
        <StatusChip domain="line" status={p.status} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12.5px]">
        <span className="text-muted">
          {t('orders.ordered')}: <span className="font-medium tabular text-fg">{p.ordered}</span>
        </span>
        <span className="text-muted">
          {t('orders.allocated')}: <span className="font-medium tabular text-fg">{p.allocated}</span>
        </span>
        {p.remaining > 0 && (
          <span className="text-warn">
            {t('orders.remaining')}: <span className="font-medium tabular">{p.remaining}</span>
          </span>
        )}
        {p.overBy > 0 && (
          <span className="text-late">
            {t('orders.over')}: <span className="font-medium tabular">{p.overBy}</span>
          </span>
        )}
        {diverged && (
          <span className="text-subtle">{t('orders.proposedQuantity', { qty: proposed })}</span>
        )}
      </div>

      {line.allocations.length > 0 && (
        <ul className="mt-2 space-y-1">
          {line.allocations.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-surface-2/60 px-2 py-1 text-[12.5px]"
            >
              <span className="font-medium tabular">{a.lot_number}</span>
              <span className="tabular text-muted">× {toQuantity(a.quantity)}</span>
              {a.note && <span className="min-w-0 flex-1 truncate text-subtle">{a.note}</span>}
              {/* Who recorded this lot. Already in the payload; never shown. */}
              <span className="ml-auto shrink-0 text-[11.5px] text-subtle">
                {t('common.byAt', {
                  name: a.author?.name ?? a.author?.email ?? '—',
                  time: DateTime.fromISO(a.created_at)
                    .setZone(BUSINESS_TZ)
                    .setLocale(locale)
                    .toFormat('d LLL, HH:mm'),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {line.shortfall_reason && (
        <p className="mt-2 rounded-md bg-surface-2 px-2 py-1 text-[12px] text-muted">
          <span className="font-medium">{t('prep.shortfallReason')}:</span> {line.shortfall_reason}
        </p>
      )}
    </li>
  );
}
