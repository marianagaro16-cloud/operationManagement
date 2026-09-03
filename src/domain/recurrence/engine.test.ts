import { describe, it, expect } from 'vitest';
import {
  generateOccurrences,
  resolveScheduleConfig,
  nthWeekdayOfMonth,
  dayOfMonthClamped,
  isOverdue,
  daysLate,
  type TaskDefinitionLike,
} from './engine';
import { periodKeyForDate, periodWindow, weeklyPeriodKey } from './periods';
import { DateTime } from 'luxon';
import { BUSINESS_TZ, WEEKDAY } from '@/lib/datetime';
import { DEFAULT_DAILY_WEEKDAYS } from './types';

/**
 * NOTE: vitest.config.ts pins TZ=America/New_York for this suite. Every
 * expectation below is a Europe/Zurich business date, so any accidental
 * reliance on the ambient timezone fails loudly here.
 */

function task(partial: Partial<TaskDefinitionLike> & Pick<TaskDefinitionLike, 'frequency' | 'schedule_config'>): TaskDefinitionLike {
  return { id: 't1', is_active: true, ...partial };
}

const dates = (o: { dueDate: string }[]) => o.map((x) => x.dueDate);
const keys = (o: { periodKey: string }[]) => o.map((x) => x.periodKey);

describe('daily', () => {
  it('produces one requirement on every day of the range', () => {
    const out = generateOccurrences(
      task({ frequency: 'daily', schedule_config: { kind: 'daily' } }),
      '2026-09-01',
      '2026-09-07',
    );
    expect(dates(out)).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
      '2026-09-05', '2026-09-06', '2026-09-07',
    ]);
    expect(keys(out)[0]).toBe('2026-09-01');
  });

  it('honours an optional weekday restriction (Mon-Fri)', () => {
    const out = generateOccurrences(
      task({ frequency: 'daily', schedule_config: { kind: 'daily', weekdays: [1, 2, 3, 4, 5] } }),
      '2026-09-01',
      '2026-09-07',
    );
    // 5th = Saturday, 6th = Sunday 2026
    expect(dates(out)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07']);
  });

  it('DEFAULT_DAILY_WEEKDAYS excludes the weekend — the warehouse is closed', () => {
    expect(DEFAULT_DAILY_WEEKDAYS).toEqual([1, 2, 3, 4, 5]);

    const out = generateOccurrences(
      task({ frequency: 'daily', schedule_config: { kind: 'daily', weekdays: DEFAULT_DAILY_WEEKDAYS } }),
      '2026-09-01',
      '2026-09-30',
    );
    const weekends = out.filter((o) => {
      const d = DateTime.fromISO(o.dueDate, { zone: BUSINESS_TZ }).weekday;
      return d === 6 || d === 7;
    });
    expect(weekends).toEqual([]);
    // September 2026 has 22 working days.
    expect(out).toHaveLength(22);
  });

  it('generates every calendar day only when no restriction is set', () => {
    const out = generateOccurrences(
      task({ frequency: 'daily', schedule_config: { kind: 'daily' } }),
      '2026-09-01',
      '2026-09-30',
    );
    expect(out).toHaveLength(30);
  });
});

describe('weekly', () => {
  it('schedules on the configured Tuesday', () => {
    const out = generateOccurrences(
      task({ frequency: 'weekly', schedule_config: { kind: 'weekly', weekday: WEEKDAY.TUESDAY } }),
      '2026-09-01',
      '2026-09-30',
    );
    expect(dates(out)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
  });

  it('schedules on the configured Thursday', () => {
    const out = generateOccurrences(
      task({ frequency: 'weekly', schedule_config: { kind: 'weekly', weekday: WEEKDAY.THURSDAY } }),
      '2026-09-01',
      '2026-09-30',
    );
    expect(dates(out)).toEqual(['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24']);
  });

  it('CRITICAL: completing on Tuesday satisfies a Thursday-scheduled week', () => {
    // The Thursday requirement for the week of 2026-09-07.
    const thursday = generateOccurrences(
      task({ frequency: 'weekly', schedule_config: { kind: 'weekly', weekday: WEEKDAY.THURSDAY } }),
      '2026-09-07',
      '2026-09-13',
    );
    expect(dates(thursday)).toEqual(['2026-09-10']);

    // A user acting on Tuesday resolves to the SAME period key, so the action
    // lands on the existing weekly requirement instead of creating a new one.
    const actedOn = '2026-09-08'; // Tuesday of that week
    expect(periodKeyForDate('weekly', actedOn, { kind: 'weekly', weekday: WEEKDAY.THURSDAY }))
      .toBe(thursday[0].periodKey);

    // ...and Thursday must not raise a second requirement.
    expect(new Set(keys(thursday)).size).toBe(1);
  });

  it('keeps one requirement per ISO week across a year boundary', () => {
    expect(weeklyPeriodKey('2026-12-31')).toBe(weeklyPeriodKey('2027-01-01'));
  });

  it('marks a weekly task overdue after its due day but keeps it in the week window', () => {
    const due = '2026-09-10'; // Thursday
    expect(isOverdue('pending', due, '2026-09-11')).toBe(true);
    expect(daysLate(due, '2026-09-13')).toBe(3);
    const w = periodWindow('weekly', due);
    expect(w.start).toBe('2026-09-07');
    expect(w.end).toBe('2026-09-13');
  });
});

describe('biweekly', () => {
  const cfg = { kind: 'biweekly' as const, anchorDate: '2026-09-08' };

  it('starts at the anchor and repeats every 14 days', () => {
    const out = generateOccurrences(
      task({ frequency: 'biweekly', schedule_config: cfg }),
      '2026-09-01',
      '2026-10-31',
    );
    expect(dates(out)).toEqual(['2026-09-08', '2026-09-22', '2026-10-06', '2026-10-20']);
  });

  it('does not generate before the anchor', () => {
    const out = generateOccurrences(
      task({ frequency: 'biweekly', schedule_config: cfg }),
      '2026-08-01',
      '2026-09-07',
    );
    expect(out).toEqual([]);
  });

  it('resolves an arbitrary date to its enclosing cycle', () => {
    expect(periodKeyForDate('biweekly', '2026-09-20', cfg)).toBe('BW-2026-09-08');
    expect(periodKeyForDate('biweekly', '2026-09-22', cfg)).toBe('BW-2026-09-22');
  });

  it('generates nothing when the anchor is missing, rather than inventing one', () => {
    const out = generateOccurrences(
      task({ frequency: 'biweekly', schedule_config: null }),
      '2026-09-01',
      '2026-12-31',
    );
    expect(out).toEqual([]);
    const r = resolveScheduleConfig('biweekly', null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.code).toBe('missing_config');
  });

  it('crosses the October DST boundary without drifting', () => {
    // Zurich leaves DST on 2026-10-25. 14-day steps must stay on the weekday.
    const out = generateOccurrences(
      task({ frequency: 'biweekly', schedule_config: { kind: 'biweekly', anchorDate: '2026-10-13' } }),
      '2026-10-01',
      '2026-11-30',
    );
    expect(dates(out)).toEqual(['2026-10-13', '2026-10-27', '2026-11-10', '2026-11-24']);
  });
});

describe('monthly', () => {
  it('defaults to the last Thursday of each month', () => {
    const out = generateOccurrences(
      task({ frequency: 'monthly', schedule_config: { kind: 'monthly', rule: { type: 'nthWeekday', nth: -1, weekday: WEEKDAY.THURSDAY } } }),
      '2026-09-01',
      '2026-12-31',
    );
    expect(dates(out)).toEqual(['2026-09-24', '2026-10-29', '2026-11-26', '2026-12-31']);
    expect(keys(out)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
  });

  it('handles every month length including leap February', () => {
    expect(nthWeekdayOfMonth(2024, 2, WEEKDAY.THURSDAY, -1)).toBe('2024-02-29'); // leap
    expect(nthWeekdayOfMonth(2026, 2, WEEKDAY.THURSDAY, -1)).toBe('2026-02-26');
    expect(nthWeekdayOfMonth(2026, 4, WEEKDAY.THURSDAY, -1)).toBe('2026-04-30'); // 30-day
    expect(nthWeekdayOfMonth(2026, 1, WEEKDAY.THURSDAY, 1)).toBe('2026-01-01');
  });

  it('clamps a day-of-month rule to short months', () => {
    expect(dayOfMonthClamped(2026, 2, 31)).toBe('2026-02-28');
    expect(dayOfMonthClamped(2024, 2, 31)).toBe('2024-02-29');
    expect(dayOfMonthClamped(2026, 4, 31)).toBe('2026-04-30');
    expect(dayOfMonthClamped(2026, 1, 15)).toBe('2026-01-15');
  });

  it('emits exactly one requirement per calendar month', () => {
    const out = generateOccurrences(
      task({ frequency: 'monthly', schedule_config: { kind: 'monthly', rule: { type: 'dayOfMonth', day: 15 } } }),
      '2026-01-01',
      '2026-12-31',
    );
    expect(out).toHaveLength(12);
    expect(new Set(keys(out)).size).toBe(12);
  });
});

describe('semiannual', () => {
  it('defaults to June 30 and December 31', () => {
    const out = generateOccurrences(
      task({ frequency: 'semiannual', schedule_config: { kind: 'semiannual', dates: [{ month: 6, day: 30 }, { month: 12, day: 31 }] } }),
      '2026-01-01',
      '2027-12-31',
    );
    expect(dates(out)).toEqual(['2026-06-30', '2026-12-31', '2027-06-30', '2027-12-31']);
    expect(keys(out)).toEqual(['2026-H1', '2026-H2', '2027-H1', '2027-H2']);
  });

  it('collapses two dates landing in the same half-year to one requirement', () => {
    const out = generateOccurrences(
      task({ frequency: 'semiannual', schedule_config: { kind: 'semiannual', dates: [{ month: 3, day: 1 }, { month: 5, day: 1 }] } }),
      '2026-01-01',
      '2026-12-31',
    );
    expect(keys(out)).toEqual(['2026-H1']);
  });

  it('bounds the half-year window correctly', () => {
    expect(periodWindow('semiannual', '2026-06-30')).toEqual({ start: '2026-01-01', end: '2026-06-30' });
    expect(periodWindow('semiannual', '2026-12-31')).toEqual({ start: '2026-07-01', end: '2026-12-31' });
  });
});

describe('configuration validation', () => {
  it('rejects a config whose kind does not match the frequency', () => {
    const r = resolveScheduleConfig('monthly', { kind: 'weekly', weekday: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.code).toBe('kind_mismatch');
  });

  it('rejects a structurally invalid config', () => {
    const r = resolveScheduleConfig('weekly', { kind: 'weekly', weekday: 9 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.code).toBe('invalid_config');
  });

  it('accepts each valid default', () => {
    expect(resolveScheduleConfig('weekly', { kind: 'weekly', weekday: 2 }).ok).toBe(true);
    expect(resolveScheduleConfig('monthly', { kind: 'monthly', rule: { type: 'nthWeekday', nth: -1, weekday: 4 } }).ok).toBe(true);
    expect(resolveScheduleConfig('semiannual', { kind: 'semiannual', dates: [{ month: 6, day: 30 }, { month: 12, day: 31 }] }).ok).toBe(true);
  });
});

describe('timezone correctness', () => {
  it('computes March DST-transition dates on Zurich boundaries', () => {
    // Zurich enters DST 2026-03-29. A daily range across it must not skip or
    // duplicate a day, which a naive UTC-hour-addition implementation would.
    const out = generateOccurrences(
      task({ frequency: 'daily', schedule_config: { kind: 'daily' } }),
      '2026-03-28',
      '2026-03-31',
    );
    expect(dates(out)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
  });

  it('computes October DST-transition dates on Zurich boundaries', () => {
    const out = generateOccurrences(
      task({ frequency: 'daily', schedule_config: { kind: 'daily' } }),
      '2026-10-24',
      '2026-10-27',
    );
    expect(dates(out)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('keeps Dec 31 in H2 of the correct year', () => {
    expect(periodKeyForDate('semiannual', '2026-12-31', null)).toBe('2026-H2');
    expect(periodKeyForDate('semiannual', '2027-01-01', null)).toBe('2027-H1');
  });
});

describe('inactive and unconfigured definitions', () => {
  it('yields nothing for an invalid config instead of throwing', () => {
    const out = generateOccurrences(
      task({ frequency: 'monthly', schedule_config: { kind: 'monthly', rule: { type: 'bogus' } } }),
      '2026-01-01',
      '2026-12-31',
    );
    expect(out).toEqual([]);
  });
});
