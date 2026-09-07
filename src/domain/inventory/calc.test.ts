import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  difference,
  editDeadline,
  instanceStatus,
  isDigitalPending,
  isPastEditDeadline,
  itemStatus,
  minutesUntilDeadline,
  parseQuantityInput,
  physicalStock,
  validateQuantity,
} from './calc';
import { BUSINESS_TZ } from '@/lib/datetime';

/** An instant on a given Zurich wall-clock time, whatever the ambient TZ is. */
const zurich = (iso: string) =>
  DateTime.fromISO(iso, { zone: BUSINESS_TZ }).toJSDate();

describe('physicalStock', () => {
  it('sums the quantity records — the user never types the total', () => {
    // The worked example from the specification.
    expect(physicalStock([{ quantity: 20 }, { quantity: 15 }, { quantity: 30 }])).toBe(65);
  });

  it('sums packaging locations the same way', () => {
    expect(physicalStock([{ quantity: 100 }, { quantity: 50 }])).toBe(150);
  });

  it('treats an uncounted record as contributing nothing, not as a zero', () => {
    expect(physicalStock([{ quantity: 10 }, { quantity: null }])).toBe(10);
  });

  it('counts an explicit zero, which is a real count', () => {
    expect(physicalStock([{ quantity: 0 }, { quantity: 5 }])).toBe(5);
  });

  it('adds duplicate expiry records rather than merging them', () => {
    // "10 -> 15.09" and "5 -> 15.09" are two things somebody counted.
    expect(physicalStock([{ quantity: 10 }, { quantity: 5 }])).toBe(15);
  });

  it('is zero for an item nobody has touched', () => {
    expect(physicalStock([])).toBe(0);
  });
});

describe('difference', () => {
  it('is positive when physical exceeds digital', () => {
    expect(difference(100, 95, true)).toBe(5);
  });

  it('is negative when digital exceeds physical', () => {
    expect(difference(95, 100, true)).toBe(-5);
  });

  it('is zero when they agree', () => {
    expect(difference(100, 100, true)).toBe(0);
  });

  it('is null — never zero — while Inventory Digital is pending', () => {
    // Showing 0 here would be the one genuinely misleading thing this
    // screen could do.
    expect(difference(100, null, true)).toBeNull();
  });

  it('is null when the template does not use Inventory Digital at all', () => {
    expect(difference(100, 95, false)).toBeNull();
  });
});

describe('isDigitalPending', () => {
  it('is true only when the template uses Inventory Digital and none is set', () => {
    expect(isDigitalPending(true, null)).toBe(true);
    expect(isDigitalPending(true, 0)).toBe(false);
    expect(isDigitalPending(false, null)).toBe(false);
  });
});

describe('itemStatus', () => {
  const base = {
    digitalEnabled: true,
    digitalQuantity: null as number | null,
    physicalStock: 0,
    isResolved: false,
    instanceCompleted: false,
  };

  it('is Completed when the difference is zero', () => {
    expect(itemStatus({ ...base, physicalStock: 100, digitalQuantity: 100 })).toBe('completed');
  });

  it('is To review when the difference is not zero', () => {
    expect(itemStatus({ ...base, physicalStock: 97, digitalQuantity: 100 })).toBe('to_review');
    expect(itemStatus({ ...base, physicalStock: 103, digitalQuantity: 100 })).toBe('to_review');
  });

  it('stays In progress while Inventory Digital is pending', () => {
    expect(itemStatus({ ...base, physicalStock: 100 })).toBe('in_progress');
  });

  it('is Resolved even though the difference is still non-zero', () => {
    // The specification's example: physical 97, digital 100, admin decides.
    expect(
      itemStatus({ ...base, physicalStock: 97, digitalQuantity: 100, isResolved: true }),
    ).toBe('resolved');
  });

  it('completes on instance completion when Inventory Digital is disabled', () => {
    expect(
      itemStatus({ ...base, digitalEnabled: false, instanceCompleted: true }),
    ).toBe('completed');
    expect(
      itemStatus({ ...base, digitalEnabled: false, instanceCompleted: false }),
    ).toBe('in_progress');
  });

  it('never asks for a difference on a template with Inventory Digital off', () => {
    // Even with a stray digital value, a disabled template does not reconcile.
    expect(
      itemStatus({
        ...base,
        digitalEnabled: false,
        digitalQuantity: 50,
        physicalStock: 10,
        instanceCompleted: true,
      }),
    ).toBe('completed');
  });
});

describe('instanceStatus', () => {
  it('is In progress until the count is completed', () => {
    expect(instanceStatus({ completedAt: null, itemStatuses: ['completed'] })).toBe('in_progress');
  });

  it('is To review if any single item needs review', () => {
    expect(
      instanceStatus({ completedAt: 'x', itemStatuses: ['completed', 'to_review', 'resolved'] }),
    ).toBe('to_review');
  });

  it('is Resolved when the only unfinished items were resolved', () => {
    expect(instanceStatus({ completedAt: 'x', itemStatuses: ['completed', 'resolved'] })).toBe(
      'resolved',
    );
  });

  it('is Completed when everything reconciles', () => {
    expect(instanceStatus({ completedAt: 'x', itemStatuses: ['completed', 'completed'] })).toBe(
      'completed',
    );
  });
});

describe('the 18:00 editing deadline', () => {
  it('is 18:00 Zurich on the day of the inventory', () => {
    const deadline = editDeadline('2026-09-11');
    expect(deadline.setZone(BUSINESS_TZ).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-11 18:00');
  });

  it('is still 18:00 local in winter, when Zurich is UTC+1', () => {
    const deadline = editDeadline('2026-12-11');
    expect(deadline.setZone(BUSINESS_TZ).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-12-11 18:00');
  });

  it('has not passed at 17:59 and has at 18:01', () => {
    expect(isPastEditDeadline('2026-09-11', zurich('2026-09-11T17:59'))).toBe(false);
    expect(isPastEditDeadline('2026-09-11', zurich('2026-09-11T18:01'))).toBe(true);
  });

  it('has passed for a previous day, however early it is now', () => {
    expect(isPastEditDeadline('2026-09-10', zurich('2026-09-11T08:00'))).toBe(true);
  });

  it('counts down the remaining minutes and floors at zero', () => {
    expect(minutesUntilDeadline('2026-09-11', zurich('2026-09-11T17:30'))).toBe(30);
    expect(minutesUntilDeadline('2026-09-11', zurich('2026-09-11T19:00'))).toBe(0);
  });
});

describe('quantity validation', () => {
  it('accepts whole numbers including zero', () => {
    expect(validateQuantity(0)).toBeNull();
    expect(validateQuantity(65)).toBeNull();
  });

  it('accepts null — a quantity is optional', () => {
    expect(validateQuantity(null)).toBeNull();
  });

  it('rejects decimals rather than rounding them', () => {
    expect(validateQuantity(0.5)).toBe('not_an_integer');
    expect(validateQuantity(1.0001)).toBe('not_an_integer');
  });

  it('rejects negatives', () => {
    expect(validateQuantity(-1)).toBe('negative');
  });
});

describe('parseQuantityInput', () => {
  it('reads an empty field as "not counted", not as zero', () => {
    expect(parseQuantityInput('  ')).toEqual({ ok: true, value: null });
  });

  it('reads a whole number', () => {
    expect(parseQuantityInput(' 65 ')).toEqual({ ok: true, value: 65 });
    expect(parseQuantityInput('0')).toEqual({ ok: true, value: 0 });
  });

  it('rejects a decimal typed with either separator', () => {
    expect(parseQuantityInput('1.5')).toEqual({ ok: false, error: 'not_an_integer' });
    expect(parseQuantityInput('1,5')).toEqual({ ok: false, error: 'not_an_integer' });
  });

  it('rejects "1.0", which Number() would otherwise accept as an integer', () => {
    expect(parseQuantityInput('1.0')).toEqual({ ok: false, error: 'not_an_integer' });
  });

  it('rejects a negative', () => {
    expect(parseQuantityInput('-3')).toEqual({ ok: false, error: 'negative' });
  });

  it('rejects text', () => {
    expect(parseQuantityInput('abc')).toEqual({ ok: false, error: 'not_an_integer' });
  });
});
