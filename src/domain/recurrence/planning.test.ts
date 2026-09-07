import { describe, expect, it } from 'vitest';
import { expandPlanDates, fromTodayOnward, monthRange, weekRange } from './planning';
import type { Weekday } from '@/lib/datetime';

const MON: Weekday = 1;
const TUE: Weekday = 2;
const THU: Weekday = 4;
const SAT: Weekday = 6;
const SUN: Weekday = 7;

describe('expandPlanDates', () => {
  it('returns every day when no weekday is chosen', () => {
    // Empty means "do not narrow", not "nothing" — otherwise the commonest
    // bulk action, every day of the week, would be inexpressible.
    expect(expandPlanDates('2026-09-07', '2026-09-13')).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13',
    ]);
  });

  it('keeps only the chosen weekdays', () => {
    expect(expandPlanDates('2026-09-07', '2026-09-20', [TUE, THU])).toEqual([
      '2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17',
    ]);
  });

  it('includes both ends of the range', () => {
    expect(expandPlanDates('2026-09-07', '2026-09-07', [MON])).toEqual(['2026-09-07']);
  });

  it('returns nothing when the chosen weekday never falls in the range', () => {
    expect(expandPlanDates('2026-09-07', '2026-09-09', [SUN])).toEqual([]);
  });

  it('returns nothing when the range is inverted', () => {
    expect(expandPlanDates('2026-09-20', '2026-09-07')).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(expandPlanDates('2026-09-28', '2026-10-02')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ]);
  });

  it('handles a leap day', () => {
    expect(expandPlanDates('2028-02-27', '2028-03-01')).toEqual([
      '2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01',
    ]);
  });

  // Zurich has a 23-hour and a 25-hour day. Stepping by 24h would drift onto
  // the wrong date; the suite runs pinned to TZ=America/New_York so a lapse
  // back to the ambient zone fails loudly here.
  it('does not drift across the spring DST change', () => {
    expect(expandPlanDates('2026-03-28', '2026-03-31')).toEqual([
      '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31',
    ]);
  });

  it('does not drift across the autumn DST change', () => {
    expect(expandPlanDates('2026-10-24', '2026-10-27')).toEqual([
      '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27',
    ]);
  });

  it('spans a whole month without losing or repeating a day', () => {
    const dates = expandPlanDates('2026-09-01', '2026-09-30');
    expect(dates).toHaveLength(30);
    expect(new Set(dates).size).toBe(30);
  });

  it('selects weekends only when asked', () => {
    expect(expandPlanDates('2026-09-07', '2026-09-13', [SAT, SUN])).toEqual([
      '2026-09-12', '2026-09-13',
    ]);
  });
});

describe('weekRange', () => {
  // ISO weeks, matching the KW numbers the operation reads its calendar in.
  it('runs Monday to Sunday around a midweek date', () => {
    expect(weekRange('2026-09-09')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('keeps Sunday in the week that started the Monday before', () => {
    expect(weekRange('2026-09-13')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('starts a new week on Monday', () => {
    expect(weekRange('2026-09-14')).toEqual({ from: '2026-09-14', to: '2026-09-20' });
  });
});

describe('monthRange', () => {
  it('covers the whole month', () => {
    expect(monthRange('2026-09-15')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('handles a 31-day month', () => {
    expect(monthRange('2026-12-01')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('handles February in a leap year', () => {
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('fromTodayOnward', () => {
  const dates = ['2026-09-06', '2026-09-07', '2026-09-08'];

  it('keeps today itself — adding work to today is the commonest case', () => {
    expect(fromTodayOnward(dates, '2026-09-07')).toEqual(['2026-09-07', '2026-09-08']);
  });

  it('drops everything when the whole range has passed', () => {
    expect(fromTodayOnward(dates, '2026-10-01')).toEqual([]);
  });

  it('keeps everything when the range is entirely ahead', () => {
    expect(fromTodayOnward(dates, '2026-01-01')).toEqual(dates);
  });
});
