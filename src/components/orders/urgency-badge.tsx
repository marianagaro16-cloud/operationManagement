'use client';

import { useEffect, useState } from 'react';
import { Clock, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/primitives';
import { deliveryUrgency, formatDeliveryTime, type Urgency } from '@/domain/orders/urgency';

/**
 * Live countdown to a delivery deadline.
 *
 * Recomputed on a one-minute tick rather than baked into the server render,
 * because a warehouse tablet may sit on the same page for hours and a frozen
 * "5h left" would be worse than no countdown at all.
 *
 * The first render deliberately matches the server (hydration-safe); the
 * ticking starts afterwards.
 */
export function useUrgency(
  deliveryDate: string,
  deliveryTime: string | null,
  isComplete: boolean,
): Urgency {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return deliveryUrgency(deliveryDate, deliveryTime, isComplete, now ?? new Date());
}

const TONE = {
  overdue: 'late',
  critical: 'late',
  warning: 'warn',
  soon: 'neutral',
  none: 'neutral',
} as const;

export function UrgencyBadge({
  deliveryDate,
  deliveryTime,
  isComplete,
  showTime = true,
}: {
  deliveryDate: string;
  deliveryTime: string | null;
  isComplete: boolean;
  showTime?: boolean;
}) {
  const { t } = useI18n();
  const urgency = useUrgency(deliveryDate, deliveryTime, isComplete);
  const time = formatDeliveryTime(deliveryTime);

  // Nothing to say: no deadline pressure and no committed hour.
  if (urgency.level === 'none' && !time) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {showTime && time && (
        <span className="inline-flex items-center gap-1 text-[11.5px] tabular text-muted">
          <Clock className="h-3 w-3" aria-hidden />
          {time}
        </span>
      )}
      {urgency.level !== 'none' && (
        <Badge tone={TONE[urgency.level]}>
          {(urgency.level === 'overdue' || urgency.level === 'critical') && (
            <TriangleAlert className="h-2.5 w-2.5" aria-hidden />
          )}
          {countdownLabel(urgency, t)}
        </Badge>
      )}
    </span>
  );
}

/** Human countdown, degrading to a plain level when there is no exact time. */
export function countdownLabel(
  urgency: Urgency,
  t: (key: never, vars?: Record<string, string | number>) => string,
): string {
  const tt = t as unknown as (k: string, v?: Record<string, string | number>) => string;

  if (urgency.hoursRemaining === null) {
    return urgency.level === 'overdue' ? tt('urgency.overdue') : tt('urgency.dueToday');
  }
  if (urgency.isPast) {
    return urgency.hours === 0
      ? tt('urgency.lateByMinutes', { minutes: urgency.minutes })
      : tt('urgency.lateBy', { hours: urgency.hours, minutes: urgency.minutes });
  }
  return urgency.hours === 0
    ? tt('urgency.remainingMinutes', { minutes: urgency.minutes })
    : tt('urgency.remaining', { hours: urgency.hours, minutes: urgency.minutes });
}
