import type { OrderStatus } from '@/types/orders';

/**
 * Where an order is in its life, as one word for the screen.
 *
 *   draft → to_prepare → in_preparation → ready → shipped      (or cancelled)
 *
 * Only two things are stored: the commercial `status` (draft, confirmed,
 * cancelled) and the milestones `ready_at` / `shipped_at`. "To prepare" and
 * "In preparation" are read from the lots, so they can never disagree with
 * what was actually recorded. See migration 20261001090000 for why these are
 * milestones beside the status rather than more status values.
 */
export type OrderStage = 'draft' | 'cancelled' | 'to_prepare' | 'in_preparation' | 'ready' | 'shipped';

export function orderStage(order: {
  status: OrderStatus;
  ready_at?: string | null;
  shipped_at?: string | null;
  lines?: { allocations?: unknown[] | null }[] | null;
}): OrderStage {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'draft') return 'draft';
  if (order.shipped_at) return 'shipped';
  if (order.ready_at) return 'ready';
  const started = (order.lines ?? []).some((l) => (l.allocations ?? []).length > 0);
  return started ? 'in_preparation' : 'to_prepare';
}

/** Is the preparation work on this order finished (ready, or beyond)? */
export function isReadyOrShipped(order: { ready_at?: string | null }): boolean {
  return Boolean(order.ready_at);
}

/** Sort weight for lists that put what still needs work first. */
export function stageWeight(stage: OrderStage): number {
  switch (stage) {
    case 'in_preparation': return 0;
    case 'to_prepare':     return 1;
    case 'ready':          return 2;
    case 'shipped':        return 3;
    case 'draft':          return 4;
    case 'cancelled':      return 5;
  }
}
