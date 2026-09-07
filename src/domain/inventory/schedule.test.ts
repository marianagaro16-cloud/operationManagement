import { describe, it, expect } from 'vitest';
import {
  calendarWeek,
  formatCalendarWeek,
  generateInventories,
  nextInventoryDate,
  resolveInventorySchedule,
} from './schedule';
import { SECOND_THURSDAY, LAST_THURSDAY, SEMIANNUAL_CLOSE_DATES } from './types';

/**
 * NOTE: vitest.config.mts pins TZ=America/New_York. Every date below is a
 * Europe/Zurich business date, so any accidental reliance on the ambient
 * timezone fails loudly here.
 */

const dates = (plans: { inventoryDate: string }[]) => plans.map((p) => p.inventoryDate);

describe('resolveInventorySchedule', () => {
  it('reports a missing configuration rather than guessing a date', () => {
    const res = resolveInventorySchedule('weekly', null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problem.code).toBe('missing_config');
  });

  it('rejects a configuration that belongs to a different frequency', () => {
    const res = resolveInventorySchedule('weekly', { kind: 'monthly', rules: [LAST_THURSDAY] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problem.code).toBe('kind_mismatch');
  });

  it('rejects a monthly configuration with no rules', () => {
    const res = resolveInventorySchedule('monthly', { kind: 'monthly', rules: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problem.code).toBe('invalid_config');
  });
});

describe('weekly — Masamor / Del Barrio', () => {
  it('produces one Friday per ISO week', () => {
    const plans = generateInventories(
      'weekly',
      { kind: 'weekly', weekday: 5 },
      '2026-09-01',
      '2026-09-30',
    );
    expect(dates(plans)).toEqual([
      '2026-09-04',
      '2026-09-11',
      '2026-09-18',
      '2026-09-25',
    ]);
  });

  it('gives consecutive weeks distinct KW numbers, so history never collides', () => {
    const plans = generateInventories(
      'weekly',
      { kind: 'weekly', weekday: 5 },
      '2026-09-07',
      '2026-09-27',
    );
    expect(plans.map((p) => p.isoWeek)).toEqual([37, 38, 39]);
    expect(plans.map((p) => p.periodKey)).toEqual(['2026-W37', '2026-W38', '2026-W39']);
  });
});

describe('monthly — Colectivo Comestibles, twice a month', () => {
  it('produces BOTH the second and the last Thursday', () => {
    const plans = generateInventories(
      'monthly',
      { kind: 'monthly', rules: [SECOND_THURSDAY, LAST_THURSDAY] },
      '2026-09-01',
      '2026-11-30',
    );
    expect(dates(plans)).toEqual([
      '2026-09-10', // 2nd Thursday
      '2026-09-24', // last Thursday
      '2026-10-08',
      '2026-10-29',
      '2026-11-12',
      '2026-11-26',
    ]);
  });

  it('labels the two runs of a month distinctly, ordered by date', () => {
    const plans = generateInventories(
      'monthly',
      // Deliberately configured "last" first: the suffix must follow the
      // calendar, not the order an admin happened to add the rules in.
      { kind: 'monthly', rules: [LAST_THURSDAY, SECOND_THURSDAY] },
      '2026-09-01',
      '2026-09-30',
    );
    expect(plans.map((p) => p.periodKey)).toEqual(['2026-09#1', '2026-09#2']);
    expect(dates(plans)).toEqual(['2026-09-10', '2026-09-24']);
  });

  it('uses a plain month key when only one day is configured', () => {
    const plans = generateInventories(
      'monthly',
      { kind: 'monthly', rules: [LAST_THURSDAY] },
      '2026-09-01',
      '2026-09-30',
    );
    expect(plans.map((p) => p.periodKey)).toEqual(['2026-09']);
  });

  it('collapses two rules that resolve to the same day', () => {
    // In a month where "last Thursday" IS the 24th, adding day 24 must not
    // produce two inventories for one date.
    const plans = generateInventories(
      'monthly',
      { kind: 'monthly', rules: [LAST_THURSDAY, { type: 'dayOfMonth', day: 24 }] },
      '2026-09-01',
      '2026-09-30',
    );
    expect(dates(plans)).toEqual(['2026-09-24']);
  });
});

describe('monthly — Empaques, last Thursday', () => {
  it('finds the last Thursday across 28/30/31-day months', () => {
    const plans = generateInventories(
      'monthly',
      { kind: 'monthly', rules: [LAST_THURSDAY] },
      '2027-01-01',
      '2027-04-30',
    );
    expect(dates(plans)).toEqual([
      '2027-01-28',
      '2027-02-25',
      '2027-03-25',
      '2027-04-29',
    ]);
  });
});

describe('semiannual — Empaques audit count', () => {
  it('uses 30 June and 31 December when they are weekdays', () => {
    // 2026-06-30 is a Tuesday; 2026-12-31 is a Thursday.
    const plans = generateInventories(
      'semiannual',
      { kind: 'semiannual', dates: SEMIANNUAL_CLOSE_DATES },
      '2026-01-01',
      '2026-12-31',
    );
    expect(dates(plans)).toEqual(['2026-06-30', '2026-12-31']);
  });

  it('moves a Saturday close date back to the Friday before', () => {
    // 2029-06-30 is a Saturday -> 2029-06-29.
    const plans = generateInventories(
      'semiannual',
      { kind: 'semiannual', dates: SEMIANNUAL_CLOSE_DATES },
      '2029-06-01',
      '2029-06-30',
    );
    expect(dates(plans)).toEqual(['2029-06-29']);
  });

  it('moves a Sunday close date back two days to the Friday', () => {
    // 2029-12-30 is a Sunday... 2028-12-31 is a Sunday -> 2028-12-29.
    const plans = generateInventories(
      'semiannual',
      { kind: 'semiannual', dates: SEMIANNUAL_CLOSE_DATES },
      '2028-12-01',
      '2028-12-31',
    );
    expect(dates(plans)).toEqual(['2028-12-29']);
  });

  it('files a shifted date under the half-year it closes', () => {
    const plans = generateInventories(
      'semiannual',
      { kind: 'semiannual', dates: SEMIANNUAL_CLOSE_DATES },
      '2029-06-01',
      '2029-06-30',
    );
    expect(plans[0].periodKey).toBe('2029-H1');
  });
});

describe('biweekly', () => {
  it('steps 14 days from the anchor', () => {
    const plans = generateInventories(
      'biweekly',
      { kind: 'biweekly', anchorDate: '2026-09-04' },
      '2026-09-01',
      '2026-10-15',
    );
    expect(dates(plans)).toEqual(['2026-09-04', '2026-09-18', '2026-10-02']);
  });
});

describe('generation is inert when it cannot be trusted', () => {
  it('produces nothing for an unconfigured template', () => {
    expect(generateInventories('weekly', null, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('produces nothing when the range is inverted', () => {
    const plans = generateInventories(
      'weekly',
      { kind: 'weekly', weekday: 5 },
      '2026-09-30',
      '2026-09-01',
    );
    expect(plans).toEqual([]);
  });
});

describe('calendar week', () => {
  it('uses the ISO week year at a year boundary', () => {
    // 1 January 2027 is a Friday in ISO week 53 of 2026.
    expect(calendarWeek('2027-01-01')).toEqual({ isoYear: 2026, isoWeek: 53 });
  });

  it('formats a KW label with a padded number', () => {
    expect(formatCalendarWeek(7)).toBe('KW 07');
    expect(formatCalendarWeek(37)).toBe('KW 37');
  });
});

describe('nextInventoryDate', () => {
  it('finds the next occurrence on or after a date', () => {
    expect(
      nextInventoryDate('weekly', { kind: 'weekly', weekday: 5 }, '2026-09-07'),
    ).toBe('2026-09-11');
  });

  it('returns null for an unconfigured template', () => {
    expect(nextInventoryDate('monthly', null, '2026-09-07')).toBeNull();
  });
});
