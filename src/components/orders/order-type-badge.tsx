'use client';

import { useI18n, type MessageKey } from '@/i18n';
import { Badge, type Tone } from '@/components/ui/primitives';
import type { OrderType } from '@/types/orders';

/**
 * How an order's commercial type is shown on a row.
 *
 * Says nothing for a sale, because a sale is what an order is unless stated
 * otherwise, and badging the ordinary case would badge nearly every row.
 *
 * The three free types each get a badge for one reason: a month's ORDERS and
 * a month's TRADE are different numbers once some of those orders were given
 * away, and the row is where somebody notices. It used to be three copies of
 * the same pair of inline conditionals — in the order list, the order detail
 * and the preparation view — with the tone chosen separately at each site, so
 * a fourth type meant three edits and a chance of three different colours.
 */

const PRESENTATION: Partial<Record<OrderType, { key: MessageKey; tone: Tone }>> = {
  sample: { key: 'orders.typeSample', tone: 'accent' },
  // `warn`, not `accent`: a replacement is not a giveaway we planned, it is
  // one something went wrong to cause.
  replacement: { key: 'orders.typeReplacement', tone: 'warn' },
  sponsorship: { key: 'orders.typeSponsorship', tone: 'accent' },
};

export function OrderTypeBadge({ type }: { type: OrderType }) {
  const { t } = useI18n();
  const presentation = PRESENTATION[type];
  if (!presentation) return null;
  return <Badge tone={presentation.tone}>{t(presentation.key)}</Badge>;
}
