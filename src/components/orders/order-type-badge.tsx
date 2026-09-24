'use client';

import { useI18n } from '@/i18n';
import { Badge, type Tone } from '@/components/ui/primitives';
import type { OrderType } from '@/types/orders';
import { ORDER_TYPE_LABEL } from './order-types';

/**
 * How an order's commercial type is shown on a row.
 *
 * Says nothing for a sale, because a sale is what an order is unless stated
 * otherwise, and badging the ordinary case would badge nearly every row.
 *
 * Every other type gets a badge for one reason: a month's ORDERS and a
 * month's TRADE are different numbers once some of those orders were given
 * away or are still waiting to be sold, and the row is where somebody
 * notices. It used to be three copies of
 * the same pair of inline conditionals — in the order list, the order detail
 * and the preparation view — with the tone chosen separately at each site, so
 * a fourth type meant three edits and a chance of three different colours.
 */

const TONES: Partial<Record<OrderType, Tone>> = {
  // `neutral`: the goods are out but nothing went wrong and nothing was
  // given away. It is a sale that has not happened yet.
  consignment: 'neutral',
  sample: 'accent',
  // `warn`, not `accent`: a replacement is not a giveaway we planned, it is
  // one something went wrong to cause.
  replacement: 'warn',
  sponsorship: 'accent',
};

export function OrderTypeBadge({ type }: { type: OrderType }) {
  const { t } = useI18n();
  const tone = TONES[type];
  if (!tone) return null;
  return <Badge tone={tone}>{t(ORDER_TYPE_LABEL[type])}</Badge>;
}
