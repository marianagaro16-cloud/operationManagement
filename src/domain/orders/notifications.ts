import { orderProgress } from './progress';
import { compareUrgency, deliveryUrgency, formatDeliveryTime, type UrgencyLevel } from './urgency';

/**
 * Deciding WHAT to notify about.
 *
 * Pure and separated from delivery so the rules can be tested without a push
 * service. Getting this wrong is how a notification system becomes noise the
 * team mutes, so the rules are deliberately conservative:
 *
 *  - only unfinished work is ever notified
 *  - only levels that actually warrant interrupting someone
 *  - each (order, level) fires ONCE; escalating to a worse level fires again
 *  - cancelled orders never notify
 */

/** Levels worth interrupting someone for. 'soon' deliberately is not. */
export const NOTIFY_LEVELS: UrgencyLevel[] = ['warning', 'critical', 'overdue'];

export interface NotifiableOrder {
  id: string;
  reference: number;
  status: string;
  delivery_date: string;
  delivery_time: string | null;
  customer: { name: string };
  lines: {
    ordered_quantity: unknown;
    shortfall_reason?: string | null;
    allocations: { quantity: unknown }[];
  }[];
}

export interface PendingNotification {
  orderId: string;
  reference: number;
  customerName: string;
  level: Exclude<UrgencyLevel, 'soon' | 'none'>;
  deliveryTime: string | null;
  openLines: number;
  title: string;
  body: string;
}

/**
 * Which orders should notify right now.
 *
 * `alreadySent` is the set of `${orderId}:${level}` pairs already recorded,
 * so a scheduler running every 15 minutes does not re-send the same alert.
 */
export function selectNotifications(
  orders: NotifiableOrder[],
  alreadySent: Set<string>,
  now: Date = new Date(),
): PendingNotification[] {
  const out: { pending: PendingNotification; sortKey: ReturnType<typeof deliveryUrgency> }[] = [];

  for (const order of orders) {
    if (order.status === 'cancelled') continue;

    const progress = orderProgress(
      order.lines.map((l) => ({
        ordered_quantity: l.ordered_quantity,
        shortfall_reason: l.shortfall_reason ?? null,
        allocations: l.allocations,
      })),
    );
    // Finished work never interrupts anyone.
    if (progress.isComplete) continue;

    const urgency = deliveryUrgency(
      order.delivery_date,
      order.delivery_time,
      progress.isComplete,
      now,
    );
    if (!NOTIFY_LEVELS.includes(urgency.level)) continue;

    const level = urgency.level as PendingNotification['level'];
    if (alreadySent.has(`${order.id}:${level}`)) continue;

    const openLines = progress.lines - progress.complete;
    const time = formatDeliveryTime(order.delivery_time);

    out.push({
      sortKey: urgency,
      pending: {
        orderId: order.id,
        reference: order.reference,
        customerName: order.customer.name,
        level,
        deliveryTime: time,
        openLines,
        title: notificationTitle(level, order.customer.name),
        body: notificationBody(level, order.reference, time, openLines, urgency),
      },
    });
  }

  return out
    .sort((a, b) => compareUrgency(a.sortKey, b.sortKey))
    .map((x) => x.pending);
}

/**
 * Copy is Spanish, matching the operation's working language. Notifications
 * are delivered by the browser and cannot read the app's locale state, so
 * unlike in-app text they cannot go through the i18n provider.
 */
function notificationTitle(level: PendingNotification['level'], customer: string): string {
  switch (level) {
    case 'overdue':  return `Pedido atrasado — ${customer}`;
    case 'critical': return `Urgente — ${customer}`;
    case 'warning':  return `Entrega próxima — ${customer}`;
  }
}

function notificationBody(
  level: PendingNotification['level'],
  reference: number,
  time: string | null,
  openLines: number,
  urgency: ReturnType<typeof deliveryUrgency>,
): string {
  const parts: string[] = [`Pedido #${reference}`];

  if (urgency.hoursRemaining === null) {
    parts.push(level === 'overdue' ? 'entrega vencida' : 'entrega hoy');
  } else if (urgency.isPast) {
    parts.push(
      urgency.hours === 0
        ? `${urgency.minutes} min de retraso`
        : `${urgency.hours}h ${urgency.minutes}min de retraso`,
    );
  } else {
    parts.push(
      urgency.hours === 0
        ? `faltan ${urgency.minutes} min`
        : `faltan ${urgency.hours}h ${urgency.minutes}min`,
    );
  }

  if (time) parts.push(`(${time})`);
  parts.push(openLines === 1 ? '1 producto pendiente' : `${openLines} productos pendientes`);

  return parts.join(' · ');
}
