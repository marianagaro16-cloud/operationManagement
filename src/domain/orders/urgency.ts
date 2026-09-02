import { DateTime } from 'luxon';
import { BUSINESS_TZ, type BusinessDate } from '@/lib/datetime';

/**
 * Delivery urgency.
 *
 * Answers "how long until this has to leave, and should someone be worried?"
 *
 * The deadline is a wall-clock time in Europe/Zurich. Combining the date and
 * time in that zone — rather than parsing an ISO string in the browser's zone
 * — is what keeps "deliver by 14:00" meaning 14:00 in Zurich for a phone set
 * to any timezone, and keeps it correct across DST changes.
 *
 * Urgency only ever applies to work that is NOT finished. A fully prepared
 * order is never urgent, however close the deadline is; alarming people about
 * completed work is how alerts get ignored.
 */

/** Thresholds in hours. Adjust here — nothing else reads raw numbers. */
export const URGENCY_THRESHOLDS = {
  /** Past the deadline and still unfinished. */
  overdue: 0,
  /** Drop everything. */
  critical: 2,
  /** Should be in progress. */
  warning: 6,
  /** On the horizon; shown quietly. */
  soon: 24,
} as const;

export type UrgencyLevel = 'overdue' | 'critical' | 'warning' | 'soon' | 'none';

export interface Urgency {
  level: UrgencyLevel;
  /** Hours until the deadline; negative once it has passed. Null with no time. */
  hoursRemaining: number | null;
  /** Whole hours/minutes for display, always positive. */
  hours: number;
  minutes: number;
  /** True once the deadline has passed. */
  isPast: boolean;
  /** True when this needs to appear in the alert list. */
  isAlert: boolean;
}

const NONE: Urgency = {
  level: 'none',
  hoursRemaining: null,
  hours: 0,
  minutes: 0,
  isPast: false,
  isAlert: false,
};

/** The exact deadline instant, or null when no hour is committed. */
export function deliveryDeadline(
  deliveryDate: BusinessDate,
  deliveryTime: string | null,
): DateTime | null {
  if (!deliveryTime) return null;
  // Postgres returns TIME as "HH:MM:SS"; accept "HH:MM" too.
  const [h, m] = deliveryTime.split(':');
  const dt = DateTime.fromISO(deliveryDate, { zone: BUSINESS_TZ }).set({
    hour: Number(h),
    minute: Number(m ?? 0),
    second: 0,
    millisecond: 0,
  });
  return dt.isValid ? dt : null;
}

/**
 * Urgency for one order.
 *
 * `isComplete` short-circuits everything: finished work is never urgent.
 */
export function deliveryUrgency(
  deliveryDate: BusinessDate,
  deliveryTime: string | null,
  isComplete: boolean,
  now: Date = new Date(),
): Urgency {
  if (isComplete) return NONE;

  const deadline = deliveryDeadline(deliveryDate, deliveryTime);
  if (!deadline) {
    // No committed hour: fall back to day-level urgency so a late order is
    // still visible, without inventing a time it never had.
    const today = DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).toISODate() as string;
    if (deliveryDate < today) {
      return { ...NONE, level: 'overdue', isPast: true, isAlert: true };
    }
    if (deliveryDate === today) {
      return { ...NONE, level: 'warning', isAlert: true };
    }
    return NONE;
  }

  const current = DateTime.fromJSDate(now, { zone: BUSINESS_TZ });
  const hoursRemaining = deadline.diff(current, 'hours').hours;

  const level: UrgencyLevel =
    hoursRemaining < URGENCY_THRESHOLDS.overdue ? 'overdue'
      : hoursRemaining <= URGENCY_THRESHOLDS.critical ? 'critical'
        : hoursRemaining <= URGENCY_THRESHOLDS.warning ? 'warning'
          : hoursRemaining <= URGENCY_THRESHOLDS.soon ? 'soon'
            : 'none';

  const abs = Math.abs(hoursRemaining);
  return {
    level,
    hoursRemaining,
    hours: Math.floor(abs),
    minutes: Math.round((abs - Math.floor(abs)) * 60),
    isPast: hoursRemaining < 0,
    // 'soon' is informational; it does not raise an alert.
    isAlert: level === 'overdue' || level === 'critical' || level === 'warning',
  };
}

/** Most urgent first, so an alert list leads with what matters. */
const RANK: Record<UrgencyLevel, number> = {
  overdue: 0, critical: 1, warning: 2, soon: 3, none: 4,
};

export function compareUrgency(a: Urgency, b: Urgency): number {
  if (RANK[a.level] !== RANK[b.level]) return RANK[a.level] - RANK[b.level];
  // Within a level, the nearer deadline first.
  const ah = a.hoursRemaining ?? Number.POSITIVE_INFINITY;
  const bh = b.hoursRemaining ?? Number.POSITIVE_INFINITY;
  return ah - bh;
}

/** `14:30:00` -> `14:30`. */
export function formatDeliveryTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(':');
  return `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`;
}
