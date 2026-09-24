import type { MessageKey } from '@/i18n';
import type { OrderType } from '@/types/orders';

/**
 * The order types, in the one order they are offered in.
 *
 * A plain module, not a component: the new-order dialog, the badge and the
 * two filters all need the same list, and a fifth type used to mean editing
 * four places and hoping the labels matched. Adding a sixth now means adding
 * a line here.
 *
 * Sale first because it is what an order is unless stated otherwise, then
 * consignment as its nearest neighbour, then the three free types.
 */
export const ORDER_TYPES: readonly OrderType[] = [
  'sale',
  'consignment',
  'sample',
  'replacement',
  'sponsorship',
] as const;

export const ORDER_TYPE_LABEL: Record<OrderType, MessageKey> = {
  sale: 'orders.typeSale',
  consignment: 'orders.typeConsignment',
  sample: 'orders.typeSample',
  replacement: 'orders.typeReplacement',
  sponsorship: 'orders.typeSponsorship',
};

/** A filter value from a URL, or undefined when it is not a type we know. */
export function asOrderType(value: string | undefined): OrderType | undefined {
  return ORDER_TYPES.includes(value as OrderType) ? (value as OrderType) : undefined;
}
