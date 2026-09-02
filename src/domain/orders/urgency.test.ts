import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  compareUrgency,
  deliveryDeadline,
  deliveryUrgency,
  formatDeliveryTime,
} from './urgency';
import { BUSINESS_TZ } from '@/lib/datetime';

/**
 * Runs under TZ=America/New_York. Every deadline below is a Europe/Zurich
 * wall-clock time, so any accidental use of the ambient zone (a six-hour
 * error) fails loudly instead of passing on a Swiss laptop.
 */

/** An instant expressed as Zurich wall-clock, for `now`. */
const at = (iso: string) => DateTime.fromISO(iso, { zone: BUSINESS_TZ }).toJSDate();

describe('deadline construction', () => {
  it('builds the deadline in Zurich, not the ambient zone', () => {
    const d = deliveryDeadline('2026-09-10', '14:00:00');
    expect(d?.setZone(BUSINESS_TZ).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-10 14:00');
    expect(d?.zoneName).toBe(BUSINESS_TZ);
  });

  it('accepts HH:MM as well as HH:MM:SS', () => {
    expect(deliveryDeadline('2026-09-10', '09:30')?.toFormat('HH:mm')).toBe('09:30');
  });

  it('returns null when no hour is committed', () => {
    expect(deliveryDeadline('2026-09-10', null)).toBeNull();
  });

  it('keeps 14:00 at 14:00 across both DST transitions', () => {
    // Zurich enters DST 2026-03-29 and leaves it 2026-10-25. A wall-clock
    // deadline must not drift by an hour on either side.
    expect(deliveryDeadline('2026-03-28', '14:00')?.toFormat('HH:mm')).toBe('14:00');
    expect(deliveryDeadline('2026-03-30', '14:00')?.toFormat('HH:mm')).toBe('14:00');
    expect(deliveryDeadline('2026-10-24', '14:00')?.toFormat('HH:mm')).toBe('14:00');
    expect(deliveryDeadline('2026-10-26', '14:00')?.toFormat('HH:mm')).toBe('14:00');
  });
});

describe('urgency levels', () => {
  const date = '2026-09-10';
  const time = '14:00';

  it('is none when the deadline is far away', () => {
    const u = deliveryUrgency(date, time, false, at('2026-09-08T14:00'));
    expect(u.level).toBe('none');
    expect(u.isAlert).toBe(false);
  });

  it('is soon inside 24 hours but does not alert', () => {
    const u = deliveryUrgency(date, time, false, at('2026-09-09T20:00'));
    expect(u.level).toBe('soon');
    expect(u.isAlert).toBe(false);
  });

  it('is warning inside 6 hours', () => {
    const u = deliveryUrgency(date, time, false, at('2026-09-10T09:00'));
    expect(u.level).toBe('warning');
    expect(u.isAlert).toBe(true);
    expect(u.hours).toBe(5);
  });

  it('is critical inside 2 hours', () => {
    const u = deliveryUrgency(date, time, false, at('2026-09-10T12:30'));
    expect(u.level).toBe('critical');
    expect(u.isAlert).toBe(true);
    expect(u.hours).toBe(1);
    expect(u.minutes).toBe(30);
  });

  it('is overdue once the deadline has passed', () => {
    const u = deliveryUrgency(date, time, false, at('2026-09-10T15:15'));
    expect(u.level).toBe('overdue');
    expect(u.isPast).toBe(true);
    expect(u.isAlert).toBe(true);
    expect(u.hours).toBe(1);
    expect(u.minutes).toBe(15);
  });

  it('treats the exact boundaries inclusively', () => {
    expect(deliveryUrgency(date, time, false, at('2026-09-10T12:00')).level).toBe('critical');
    expect(deliveryUrgency(date, time, false, at('2026-09-10T08:00')).level).toBe('warning');
  });
});

describe('completed work is never urgent', () => {
  it('reports none even when overdue', () => {
    const u = deliveryUrgency('2026-09-10', '14:00', true, at('2026-09-11T10:00'));
    expect(u.level).toBe('none');
    expect(u.isAlert).toBe(false);
  });

  it('reports none minutes before the deadline', () => {
    expect(deliveryUrgency('2026-09-10', '14:00', true, at('2026-09-10T13:50')).level).toBe('none');
  });
});

describe('orders with no committed hour', () => {
  it('does not invent a deadline for a future date', () => {
    const u = deliveryUrgency('2026-09-12', null, false, at('2026-09-10T10:00'));
    expect(u.level).toBe('none');
    expect(u.hoursRemaining).toBeNull();
  });

  it('warns on the delivery day itself', () => {
    const u = deliveryUrgency('2026-09-10', null, false, at('2026-09-10T10:00'));
    expect(u.level).toBe('warning');
    expect(u.isAlert).toBe(true);
    expect(u.hoursRemaining).toBeNull();
  });

  it('is overdue after the delivery day', () => {
    const u = deliveryUrgency('2026-09-10', null, false, at('2026-09-11T00:30'));
    expect(u.level).toBe('overdue');
    expect(u.isPast).toBe(true);
  });

  it('uses the Zurich day boundary, not the ambient one', () => {
    // 2026-09-11 00:30 Zurich is still 2026-09-10 in New York. The order must
    // already count as overdue, which it would not if the ambient zone leaked.
    const u = deliveryUrgency('2026-09-10', null, false, at('2026-09-11T00:30'));
    expect(u.level).toBe('overdue');
  });
});

describe('ordering an alert list', () => {
  it('puts the most urgent first, then the nearest deadline', () => {
    const now = at('2026-09-10T12:00');
    const overdue = deliveryUrgency('2026-09-10', '11:00', false, now);
    const critical = deliveryUrgency('2026-09-10', '13:00', false, now);
    const warning = deliveryUrgency('2026-09-10', '17:00', false, now);
    const none = deliveryUrgency('2026-09-20', '10:00', false, now);

    const sorted = [none, warning, overdue, critical].sort(compareUrgency);
    expect(sorted.map((u) => u.level)).toEqual(['overdue', 'critical', 'warning', 'none']);
  });

  it('orders two criticals by nearest deadline', () => {
    const now = at('2026-09-10T12:00');
    const nearer = deliveryUrgency('2026-09-10', '12:30', false, now);
    const later = deliveryUrgency('2026-09-10', '13:45', false, now);
    expect([later, nearer].sort(compareUrgency)[0]).toBe(nearer);
  });
});

describe('display formatting', () => {
  it('trims seconds from a Postgres time', () => {
    expect(formatDeliveryTime('14:30:00')).toBe('14:30');
    expect(formatDeliveryTime('09:05:00')).toBe('09:05');
    expect(formatDeliveryTime(null)).toBeNull();
  });
});
