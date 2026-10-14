import type { MerchLineStatus, MerchPacking } from '@/types/merch';

/**
 * Where one customer's merch of one campaign stands.
 *
 * Derived from what is stored — the order it is on, how it was packed, and
 * whether its window ran out — so it can never disagree with the order.
 */
export function merchStatus(line: {
  packing: MerchPacking;
  expired_at: string | null;
  order: { shipped_at: string | null } | null;
}): MerchLineStatus {
  if (line.expired_at) return 'expired';
  if (line.packing === 'not_sent') return 'not_sent';
  if (!line.order) return 'waiting';
  if (line.packing === 'packed') return line.order.shipped_at ? 'sent' : 'packed';
  return 'on_order';
}

/** Finished: nothing more will happen to it. */
export function merchSettled(status: MerchLineStatus): boolean {
  return status === 'sent' || status === 'not_sent' || status === 'expired';
}

export const EMPTY_COUNTS: Record<MerchLineStatus, number> = {
  waiting: 0,
  on_order: 0,
  packed: 0,
  sent: 0,
  not_sent: 0,
  expired: 0,
};
