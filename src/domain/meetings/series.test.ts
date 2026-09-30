import { describe, expect, it } from 'vitest';
import { seriesDates, weekdayOf } from './series';

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
