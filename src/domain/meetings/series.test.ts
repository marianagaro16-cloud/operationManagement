import { describe, expect, it } from 'vitest';
import { monthlyNthOf, seriesDates, weekdayOf } from './series';

describe('seriesDates', () => {
  it('meets every week on the weekday, from the first one on or after the start', () => {
    // Wednesday 30 September 2026; Mondays.
    expect(seriesDates({ weekday: 1, interval_weeks: 1, starts_on: '2026-09-30', until: null }, '2026-09-30', '2026-10-20')).toEqual([
      '2026-10-05', '2026-10-12', '2026-10-19',
    ]);
  });
  it('keeps a fortnightly rhythm from its first meeting, whatever range is asked', () => {
    const rule = { weekday: 1, interval_weeks: 2 as const, starts_on: '2026-10-05', until: null };
    expect(seriesDates(rule, '2026-10-05', '2026-11-02')).toEqual(['2026-10-05', '2026-10-19', '2026-11-02']);
    expect(seriesDates(rule, '2026-10-10', '2026-11-10')).toEqual(['2026-10-19', '2026-11-02']);
  });
  it('stops at its last day', () => {
    expect(seriesDates({ weekday: 5, interval_weeks: 1, starts_on: '2026-10-02', until: '2026-10-16' }, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-02', '2026-10-09', '2026-10-16',
    ]);
  });
});

describe('weekdayOf', () => {
  it('counts Monday as 1', () => {
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-11')).toBe(7);
  });
});

describe('monthly series', () => {
  it('meets on the same weekday position each month', () => {
    // Monday 5 October 2026 is the first Monday.
    expect(monthlyNthOf('2026-10-05')).toBe(1);
    expect(seriesDates({ weekday: 1, interval_weeks: 1, monthly_nth: 1, starts_on: '2026-10-05', until: null }, '2026-10-01', '2027-01-31')).toEqual([
      '2026-10-05', '2026-11-02', '2026-12-07', '2027-01-04',
    ]);
  });
  it('keeps "the last" at month end, whether the month has four or five of that weekday', () => {
    // Thursday 29 October 2026 is the last Thursday.
    expect(monthlyNthOf('2026-10-29')).toBe(-1);
    expect(seriesDates({ weekday: 4, interval_weeks: 1, monthly_nth: -1, starts_on: '2026-10-29', until: null }, '2026-10-01', '2027-01-31')).toEqual([
      '2026-10-29', '2026-11-26', '2026-12-31', '2027-01-28',
    ]);
  });
  it('counts the third weekday as third, not last', () => {
    expect(monthlyNthOf('2026-10-15')).toBe(3);
  });
  it('stops at its last day and never before its start', () => {
    expect(seriesDates({ weekday: 1, interval_weeks: 1, monthly_nth: 1, starts_on: '2026-10-20', until: '2026-12-31' }, '2026-10-01', '2027-06-30')).toEqual([
      '2026-11-02', '2026-12-07',
    ]);
  });
});
