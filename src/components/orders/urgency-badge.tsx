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
          {/* The severity WORD, not only the tint. "Urgent" and "Due soon"
              were translated into all three languages and rendered nowhere,
              which left the level encoded in colour alone — unreadable in
              greyscale, and to anyone who cannot separate amber from red. */}
          <span className="font-semibold">{levelLabel(urgency.level, t)}</span>
          <span aria-hidden className="opacity-50">·</span>
          {countdownLabel(urgency, t)}
        </Badge>
      )}
    </span>
  );
}

/**
 * The severity as a word.
 *
 * `none` has no label because it renders no badge; every other level has had
 * a translated string in the dictionary since the module shipped.
 */
export function levelLabel(
  level: Urgency['level'],
  t: (key: never, vars?: Record<string, string | number>) => string,
): string {
  const tt = t as unknown as (k: string) => string;
  switch (level) {
    case 'overdue': return tt('urgency.overdue');
    case 'critical': return tt('urgency.critical');
    case 'warning': return tt('urgency.warning');
    case 'soon': return tt('urgency.soon');
    default: return '';
  }
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
