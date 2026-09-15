'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Plus, Trash2, UserRound,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn, displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shell/app-shell';
import { canAllocate, lineProgress, toQuantity } from '@/domain/orders/progress';
import { groupLinesByBrand } from '@/domain/orders/picking';
import { weekDays } from '@/domain/orders/scheduling';
import { addDays } from '@/lib/datetime';
import { UrgencyBadge } from './urgency-badge';
import { NoteBlock, NoteChip } from '@/components/ui/note';
import { productLabel, type CustomerType, type OrderLine, type OrderWithProgress } from '@/types/orders';
import { useCustomerTypeLabel } from '@/components/customers/use-customer-type-label';
import { StatusChip, statusPresentation } from '@/components/ui/status-chip';
import { OrderTypeBadge } from '@/components/orders/order-type-badge';
import { saveLotAllocation, deleteLotAllocation, setShortfallReason } from '@/server/order-actions';
import { OrderFulfilment, OrderStageChip } from './order-fulfilment';
import { orderStage, stageWeight } from '@/domain/orders/stage';

/*
 * The preparation card and its lines, used by the Orders section
 * (orders-board.tsx). The person preparing never re-enters customer, product
 * or ordered quantity — those come from the order. They enter only lot
 * number, quantity and an optional note, which is the entire point of it.
 */

/**
 * The customer's segment beside their name. Nothing is shown for a customer
 * nobody has classified — "no type" on every heading would be noise, not
 * information, for the person preparing.
 */
export function CustomerTypeBadge({ type }: { type: CustomerType | null | undefined }) {
  const label = useCustomerTypeLabel();
  if (!type) return null;
  return <Badge tone="neutral">{label(type)}</Badge>;
}

/** The last expand-all / collapse-all press. A new object each press, so pressing the same one twice still applies. */
export type BulkToggle = { expanded: boolean } | null;

/*
 * Which cards somebody opened or folded, remembered across reloads.
 *
 * In this browser only: it is how one person likes to look at the list, not
 * a fact about the order, so it has no business in the database or on
 * anybody else's screen. Entries expire after two weeks — an order's
 * preparation is long over by then — so the list cannot grow for ever.
 *
 * Every access is guarded: storage can be unavailable (private browsing,
 * blocked site data), and then the cards simply use their defaults.
 */
const EXPANDED_KEY = 'om_prep_expanded';
const EXPANDED_TTL_MS = 14 * 86_400_000;

type ExpandedStore = Record<string, { e: boolean; t: number }>;

function readExpanded(): ExpandedStore {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    return raw ? (JSON.parse(raw) as ExpandedStore) : {};
  } catch {
    return {};
  }
}

function rememberExpanded(orderId: string, expanded: boolean) {
  try {
    const now = Date.now();
    const store = readExpanded();
    for (const [id, entry] of Object.entries(store)) {
      if (now - entry.t > EXPANDED_TTL_MS) delete store[id];
    }
    store[orderId] = { e: expanded, t: now };
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(store));
  } catch {
    // Not remembered this time; the card still toggles.
  }
}

export function OrderPreparationCard({
  order,
  canManage,
  bulk,
  selection,
}: {
  order: OrderWithProgress;
  canManage: boolean;
  bulk: BulkToggle;
  /** On the Ready tab: a checkbox to include this order in a bulk Shipped. */
  selection?: { checked: boolean; onToggle: () => void };
}) {
  const { t, formatDate } = useI18n();
  // Computed once by the query layer; see OrderWithProgress.
  const progress = order.progress;

  // Who is working on it: everyone who recorded a lot, in the order they
  // started. Read from the allocations themselves, which carry their author,
  // so there is no separate 'assigned to' that could disagree with the work.
  const preparers = [...new Map(
    order.lines
      .flatMap((l) => l.allocations)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .filter((a) => a.author)
      .map((a) => [a.created_by, displayName(a.author!)] as const),
  ).values()];

  // Collapsible, so a long day reads as a list of orders rather than a wall
  // of products. Work still to do starts open; a finished order starts folded
  // — it already sits at the bottom, and its lines are only needed to check.
  const [expanded, setExpanded] = useState(!order.ready_at);

  // The server renders the default; what this browser remembers is applied
  // once mounted, because storage only exists on the client.
  useEffect(() => {
    const saved = readExpanded()[order.id];
    if (saved) setExpanded(saved.e);
  }, [order.id]);

  const setAndRemember = (next: boolean) => {
    setExpanded(next);
    rememberExpanded(order.id, next);
  };

  useEffect(() => {
    if (bulk) setAndRemember(bulk.expanded);
    // Only a new press should apply; setAndRemember is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulk]);

  return (
    <Card>
      <div
        className={cn(
          'flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3.5 py-2',
          expanded && 'border-b border-border',
        )}
        // The whole header toggles, except the links and buttons inside it,
        // which keep doing what they say.
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('a, button, input, label')) setAndRemember(!expanded);
        }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAndRemember(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? t('prep.collapse') : t('prep.expand')}
            className="-ml-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', !expanded && '-rotate-90')}
              aria-hidden
            />
          </button>
          {selection && (
            <input
              type="checkbox"
              checked={selection.checked}
              onChange={selection.onToggle}
              aria-label={t('orders.selectForShipping', { reference: order.reference })}
              className="h-5 w-5 shrink-0 accent-accent"
            />
          )}
          {/* The order this preparation belongs to, one tap away. */}
          <Link
            href={`/orders/${order.id}`}
            className="text-[12px] font-medium tabular text-muted transition-colors hover:text-accent hover:underline"
            title={t('orders.openOrder')}
          >
            #{order.reference}
          </Link>
          {order.delivery_method && (
            <Badge tone="neutral">{order.delivery_method.name}</Badge>
          )}
          {/* A sample, a replacement and a sponsorship are not sales. Saying
              so on the row is what stops a month of giveaways reading as a
              month of trade. */}
          <OrderTypeBadge type={order.order_type} />
          <OrderStageChip order={order} />
          {preparers.length > 0 && (
            <span className="inline-flex min-w-0 items-center gap-1 text-[12px] text-muted">
              <UserRound className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">
                {t(order.ready_at ? 'prep.preparedBy' : 'prep.preparingBy', { names: preparers.join(', ') })}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <UrgencyBadge
            deliveryDate={order.delivery_date}
            deliveryTime={order.delivery_time}
            isComplete={Boolean(order.ready_at)}
          />
          <span className="text-[12px] text-muted">
            {t('orders.deliveryOn', { date: formatDate(order.delivery_date, 'short') })}
          </span>
        </div>
      </div>

      {/* Folded: how far along it is, so nothing needs opening to find out. */}
      {!expanded && (
        <p className="border-t border-border px-3.5 py-1.5 text-[12px] tabular text-muted">
          {t('prep.linesDone', { done: progress.complete, total: progress.lines })}
          {progress.hasUnexplainedShortfall && (
            <span className="ml-2 text-warn">· {t('prep.shortfallRequired')}</span>
          )}
        </p>
      )}

      {/* Order-level note is shown once, never repeated per product. */}
      {expanded && order.note && (
        <NoteBlock className="border-b border-border px-3.5 py-2">{order.note}</NoteBlock>
      )}

      {/* Grouped by brand, because our own brands are stocked together and
          the line order is otherwise whatever sequence somebody typed. The
          heading shows even when an order is all one brand: a picker reads
          one layout rather than two, and knowing the shelf before starting
          is worth a single line. Quantities and positions are untouched. */}
      {expanded && groupLinesByBrand(order.lines).map((group) => (
        <div key={group.brandId ?? '__none__'}>
          <p className="border-b border-border bg-surface-2/40 px-3.5 py-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
            {group.name ?? t('master.noBrand')}
          </p>
          <ul className="divide-y divide-border">
            {group.lines.map((line) => (
              <PreparationLine key={line.id} line={line} canManage={canManage} locked={Boolean(order.ready_at)} />
            ))}
          </ul>
        </div>
      ))}

      {/* Ready and Shipped, always reachable — folded or open. */}
      <div className="border-t border-border px-3.5 py-2">
        <OrderFulfilment order={order} />
      </div>
    </Card>
  );
}

function PreparationLine({
  line,
  canManage,
  locked,
}: {
  line: OrderLine;
  canManage: boolean;
  /** The order is Ready: its lots are frozen until somebody reopens it. */
  locked: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [lot, setLot] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState(line.shortfall_reason ?? '');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = lineProgress(line.ordered_quantity, line.allocations, line.shortfall_reason);

  // Both the label and the colour come from the one registry, instead of two
  // parallel four-branch ladders that had to be kept in step by hand.
  const presentation = statusPresentation('line', progress.status);
  const tone = presentation?.tone ?? 'neutral';
  const statusLabel = presentation ? t(presentation.key) : '';

  function submitLot() {
    setError(null);
    const quantity = toQuantity(qty);

    // Mirrors the database trigger so the user gets an immediate, specific
    // message; the trigger is still what enforces it.
    const check = canAllocate(line.ordered_quantity, line.allocations, quantity, canManage);
    if (!check.ok) {
      setError(
        check.reason === 'over_allocation'
          ? t('prep.overAllocationBlocked', { available: check.available })
          : t('prep.lotQuantity'),
      );
      return;
    }
    if (!lot.trim()) { setError(t('prep.lotNumber')); return; }

    startTransition(async () => {
      const res = await saveLotAllocation({
        order_line_id: line.id,
        lot_number: lot.trim(),
        quantity,
        note: note.trim() || null,
      });
      if (!res.ok) {
        setError(res.error === 'over_allocation'
          ? t('prep.overAllocationBlocked', { available: progress.remaining })
          : res.error);
        return;
      }
      setLot(''); setQty(''); setNote(''); setAdding(false);
      router.refresh();
    });
  }

  function submitReason() {
    if (!reason.trim()) return;
    startTransition(async () => {
      const res = await setShortfallReason(line.id, reason);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <li className="px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium leading-snug">{productLabel(line.product)}</p>
          {line.product.code && (
            <span className="text-[11px] tabular text-subtle">{line.product.code}</span>
          )}
        </div>
        <Badge tone={tone}>
          {progress.status === 'complete' && <Check className="h-2.5 w-2.5" aria-hidden />}
          {statusLabel}
        </Badge>
      </div>

      {/* Ordered / allocated / remaining, always visible. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12.5px]">
        <span className="text-muted">
          {t('orders.ordered')}: <span className="font-medium tabular text-fg">{progress.ordered}</span>
        </span>
        <span className="text-muted">
          {t('orders.allocated')}: <span className="font-medium tabular text-fg">{progress.allocated}</span>
        </span>
        {progress.remaining > 0 && (
          <span className="text-warn">
            {t('orders.remaining')}: <span className="font-medium tabular">{progress.remaining}</span>
          </span>
        )}
        {progress.overBy > 0 && (
          <span className="text-late">
            {t('orders.over')}: <span className="font-medium tabular">{progress.overBy}</span>
          </span>
        )}
      </div>

      {line.allocations.length > 0 && (
        <ul className="mt-2 space-y-1">
          {line.allocations.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-md bg-surface-2/60 px-2 py-1 text-[12.5px]"
            >
              <span className="font-medium tabular">{a.lot_number}</span>
              <span className="tabular text-muted">× {toQuantity(a.quantity)}</span>
              {/* Who recorded this lot. */}
              {a.author && (
                <span className="shrink-0 text-[11.5px] text-subtle">{displayName(a.author)}</span>
              )}
              {a.note && (
                <NoteChip className="min-w-0 flex-1 truncate">{a.note}</NoteChip>
              )}
              {/* Confirmed. This fired on the first tap of a small icon, on a
                  touchscreen, next to a scrolling list, and erased a recorded
                  lot with no undo — while the confirmation text for it sat
                  translated in all three dictionaries, unused. */}
              {!locked && (
              <button
                onClick={() => setDeleting(a.id)}
                disabled={pending}
                aria-label={t('prep.deleteLot')}
                className="ml-auto shrink-0 text-subtle transition-colors hover:text-late"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <div className="mt-2"><ErrorState message={error} /></div>}

      {/* Touch-friendly lot entry: three fields, one button. */}
      {adding ? (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface-2/40 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('prep.lotNumber')} htmlFor={`lot-${line.id}`} required>
              <Input
                id={`lot-${line.id}`}
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                inputMode="numeric"
                autoFocus
              />
            </Field>
            <Field label={t('prep.lotQuantity')} htmlFor={`qty-${line.id}`} required>
              <Input
                id={`qty-${line.id}`}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                type="number"
                min="0"
                step="any"
              />
            </Field>
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('prep.lotNotePlaceholder')}
            rows={1}
            className="min-h-[38px] text-[13px]"
            aria-label={t('prep.lotNote')}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={submitLot} loading={pending}>
              {t('prep.saveLot')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        !locked && progress.status !== 'complete' && (
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('prep.addLot')}
          </Button>
        )
      )}

      {/* A shortfall may not be left silent. */}
      {!locked && progress.needsReason && (
        <div className="mt-2 rounded-lg border border-warn/30 bg-warn/[0.06] p-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-warn">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t('prep.shortfallRequired')}
          </p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('prep.shortfallPlaceholder')}
            rows={1}
            className="min-h-[38px] text-[13px]"
            aria-label={t('prep.shortfallReason')}
          />
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={submitReason}
            loading={pending}
            disabled={!reason.trim()}
          >
            {t('prep.saveReason')}
          </Button>
        </div>
      )}

      {line.shortfall_reason && !progress.needsReason && progress.status === 'partial' && (
        <p className="mt-2 rounded-md bg-surface-2 px-2 py-1 text-[12px] text-muted">
          <span className="font-medium">{t('prep.shortfallReason')}:</span> {line.shortfall_reason}
        </p>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const id = deleting;
          setDeleting(null);
          if (!id) return;
          startTransition(async () => {
            await deleteLotAllocation(id);
            router.refresh();
          });
        }}
        title={t('prep.deleteLot')}
        message={t('prep.deleteLotConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
    </li>
  );
}
