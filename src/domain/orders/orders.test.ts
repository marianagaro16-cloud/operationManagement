import { describe, it, expect } from 'vitest';
import {
  allocatedQuantity,
  canAllocate,
  lineProgress,
  orderProgress,
  toQuantity,
} from './progress';
import {
  defaultPreparationDate,
  isValidSchedule,
  monthRange,
  nextWeekdayOnOrAfter,
  preparationDateFor,
  proposedDeliveryDates,
  weekDays,
} from './scheduling';

/**
 * Runs under TZ=America/New_York (see vitest.config.mts). Every expectation
 * is a Europe/Zurich business date, so ambient-timezone reliance fails loudly.
 */

const alloc = (...q: number[]) => q.map((quantity) => ({ quantity }));

describe('quantity semantics', () => {
  it('treats quantity as a count of packages, never converting presentations', () => {
    // The verified Los Guapos order: 9 packages of 1.75kg and 4 of 2kg.
    // 9 stays 9 — it is not multiplied into 15.75 kg.
    expect(lineProgress(9, alloc(9)).status).toBe('complete');
    expect(lineProgress(4, alloc(4)).allocated).toBe(4);
  });

  it('parses numeric(12,3) values arriving as strings', () => {
    expect(toQuantity('10.500')).toBe(10.5);
    expect(toQuantity(null)).toBe(0);
    expect(toQuantity('nonsense')).toBe(0);
  });

  it('does not drift when summing fractional quantities', () => {
    expect(allocatedQuantity(alloc(0.1, 0.2))).toBe(0.3);
  });
});

describe('multiple lots per line', () => {
  it('aggregates several lots into one allocated total', () => {
    // The core Lotnummerkontrol case: ordered 10, lots 6 + 4.
    const p = lineProgress(10, alloc(6, 4));
    expect(p.ordered).toBe(10);
    expect(p.allocated).toBe(10);
    expect(p.remaining).toBe(0);
    expect(p.status).toBe('complete');
  });

  it('reports a partial preparation with the remainder', () => {
    const p = lineProgress(10, alloc(7));
    expect(p.allocated).toBe(7);
    expect(p.remaining).toBe(3);
    expect(p.status).toBe('partial');
  });

  it('reports an untouched line as not prepared', () => {
    const p = lineProgress(10, []);
    expect(p.allocated).toBe(0);
    expect(p.remaining).toBe(10);
    expect(p.status).toBe('not_prepared');
  });
});

describe('shortfall reason', () => {
  it('requires a reason for a partial line', () => {
    expect(lineProgress(10, alloc(8)).needsReason).toBe(true);
  });

  it('is satisfied once a reason is given', () => {
    expect(lineProgress(10, alloc(8), 'Only 8 packs left in stock').needsReason).toBe(false);
  });

  it('ignores a whitespace-only reason', () => {
    expect(lineProgress(10, alloc(8), '   ').needsReason).toBe(true);
  });

  it('does not demand a reason for an untouched or complete line', () => {
    expect(lineProgress(10, []).needsReason).toBe(false);
    expect(lineProgress(10, alloc(10)).needsReason).toBe(false);
  });
});

describe('over-allocation', () => {
  it('blocks a user from allocating more than ordered', () => {
    const r = canAllocate(10, alloc(6), 5, false);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('over_allocation');
      expect(r.available).toBe(4);
    }
  });

  it('allows a user to allocate exactly the remainder', () => {
    expect(canAllocate(10, alloc(6), 4, false).ok).toBe(true);
  });

  it('permits an admin to exceed, for real-world corrections', () => {
    expect(canAllocate(10, alloc(6), 5, true).ok).toBe(true);
  });

  it('rejects zero and negative quantities for everyone', () => {
    expect(canAllocate(10, [], 0, true).ok).toBe(false);
    expect(canAllocate(10, [], -1, true).ok).toBe(false);
  });

  it('excludes the edited allocation from the total when updating', () => {
    // Editing the 6 up to 10 is fine: 10 total, not 16.
    expect(canAllocate(10, alloc(6), 10, false, 6).ok).toBe(true);
  });

  it('flags an existing over-allocation an admin created', () => {
    const p = lineProgress(10, alloc(12));
    expect(p.status).toBe('over_allocated');
    expect(p.overBy).toBe(2);
    expect(p.remaining).toBe(0);
  });
});

describe('admin changing ordered quantity after preparation started', () => {
  it('recalculates remaining without destroying allocations', () => {
    const allocations = alloc(8); // already prepared

    const before = lineProgress(10, allocations);
    expect(before.remaining).toBe(2);

    // Admin raises the order 10 -> 12. The 8 already allocated stand.
    const after = lineProgress(12, allocations);
    expect(after.ordered).toBe(12);
    expect(after.allocated).toBe(8);
    expect(after.remaining).toBe(4);
    expect(after.status).toBe('partial');
  });

  it('turns a complete line into an over-allocation if the order is cut', () => {
    const allocations = alloc(10);
    const after = lineProgress(6, allocations);
    expect(after.status).toBe('over_allocated');
    expect(after.overBy).toBe(4);
  });
});

describe('order-level aggregation', () => {
  const line = (ordered: number, qs: number[], reason?: string) => ({
    ordered_quantity: ordered,
    shortfall_reason: reason ?? null,
    allocations: alloc(...qs),
  });

  it('is complete only when every line is complete', () => {
    const p = orderProgress([line(10, [6, 4]), line(5, [5])]);
    expect(p.isComplete).toBe(true);
    expect(p.complete).toBe(2);
    expect(p.hasUnexplainedShortfall).toBe(false);
  });

  it('reports a mixed order as partial', () => {
    const p = orderProgress([line(10, [10]), line(5, [2])]);
    expect(p.isComplete).toBe(false);
    expect(p.isPartial).toBe(true);
    expect(p.partial).toBe(1);
    expect(p.complete).toBe(1);
  });

  it('surfaces unexplained shortfalls across the order', () => {
    expect(orderProgress([line(10, [8])]).hasUnexplainedShortfall).toBe(true);
    expect(orderProgress([line(10, [8], 'short stock')]).hasUnexplainedShortfall).toBe(false);
  });

  it('treats a wholly untouched order as not started', () => {
    const p = orderProgress([line(10, []), line(5, [])]);
    expect(p.notPrepared).toBe(2);
    expect(p.isPartial).toBe(false);
    expect(p.isComplete).toBe(false);
  });
});

describe('preparation vs delivery date', () => {
  it('defaults preparation to the delivery date', () => {
    expect(defaultPreparationDate('2026-09-10')).toBe('2026-09-10');
  });

  it('moves preparation earlier by the lead time', () => {
    // The spec example: deliver Thursday 10th, prepare Wednesday 9th.
    expect(preparationDateFor('2026-09-10', 1)).toBe('2026-09-09');
    expect(preparationDateFor('2026-09-10', 0)).toBe('2026-09-10');
  });

  it('crosses a month boundary correctly', () => {
    expect(preparationDateFor('2026-10-01', 1)).toBe('2026-09-30');
  });

  it('crosses the Zurich DST boundary without slipping a day', () => {
    // Zurich leaves DST on 2026-10-25.
    expect(preparationDateFor('2026-10-26', 1)).toBe('2026-10-25');
    expect(preparationDateFor('2026-10-25', 1)).toBe('2026-10-24');
    // And entering DST on 2026-03-29.
    expect(preparationDateFor('2026-03-30', 1)).toBe('2026-03-29');
  });

  it('rejects preparation after delivery', () => {
    expect(isValidSchedule('2026-09-10', '2026-09-09')).toBe(true);
    expect(isValidSchedule('2026-09-10', '2026-09-10')).toBe(true);
    expect(isValidSchedule('2026-09-10', '2026-09-11')).toBe(false);
  });
});

describe('month and week windows', () => {
  it('bounds a month in Zurich', () => {
    expect(monthRange('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });

  it('returns Monday-first weekday navigation', () => {
    const days = weekDays('2026-09-09'); // a Wednesday
    expect(days[0]).toBe('2026-09-07');
    expect(days[6]).toBe('2026-09-13');
  });
});

describe('recurring order templates', () => {
  it('finds the next occurrence of a weekday', () => {
    // 2026-09-07 is a Monday.
    expect(nextWeekdayOnOrAfter('2026-09-07', 1)).toBe('2026-09-07');
    expect(nextWeekdayOnOrAfter('2026-09-07', 3)).toBe('2026-09-09');
    expect(nextWeekdayOnOrAfter('2026-09-10', 1)).toBe('2026-09-14');
  });

  it('proposes weekly delivery dates across a window', () => {
    // Every Wednesday in September 2026.
    expect(proposedDeliveryDates(3, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30',
    ]);
  });

  it('proposes nothing when the window contains no such weekday', () => {
    expect(proposedDeliveryDates(1, '2026-09-01', '2026-09-06')).toEqual([]);
  });
});
