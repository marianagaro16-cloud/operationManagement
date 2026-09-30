import { describe, expect, it } from 'vitest';
import { DEFAULT_HOURS, absenceGaps, coverageConflicts, gaps, requiredWindow, workingDays, type AbsenceSpan } from './coverage';

// Monday 12 October 2026 to Friday 16 October 2026.
const week: AbsenceSpan = { start_date: '2026-10-12', end_date: '2026-10-16', first_day: 'full', last_day: 'full' };

describe('workingDays', () => {
  it('skips the weekend', () => {
    expect(workingDays({ ...week, end_date: '2026-10-19' }, DEFAULT_HOURS)).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19',
    ]);
  });
});

describe('requiredWindow', () => {
  it('is the working day, halved on a first afternoon or a last morning', () => {
    const half: AbsenceSpan = { ...week, first_day: 'afternoon', last_day: 'morning' };
    expect(requiredWindow(half, '2026-10-12', DEFAULT_HOURS)).toEqual({ start: '12:00', end: '18:00' });
    expect(requiredWindow(half, '2026-10-14', DEFAULT_HOURS)).toEqual({ start: '08:00', end: '18:00' });
    expect(requiredWindow(half, '2026-10-16', DEFAULT_HOURS)).toEqual({ start: '08:00', end: '12:00' });
  });
  it('is nothing on a weekend or outside the absence', () => {
    expect(requiredWindow({ ...week, end_date: '2026-10-18' }, '2026-10-17', DEFAULT_HOURS)).toBeNull();
    expect(requiredWindow(week, '2026-10-20', DEFAULT_HOURS)).toBeNull();
  });
});

describe('gaps', () => {
  const day = { start: '08:00', end: '18:00' };
  it('is the whole window when nothing covers it', () => {
    expect(gaps(day, [])).toEqual([day]);
  });
  it('is nothing when split coverage fills it', () => {
    expect(gaps(day, [{ start: '12:00', end: '18:00' }, { start: '08:00', end: '12:00' }])).toEqual([]);
  });
  it('finds the holes between and after periods, overlapping ones merged', () => {
    expect(gaps(day, [{ start: '08:00', end: '11:00' }, { start: '10:00', end: '12:00' }, { start: '14:00', end: '16:00' }])).toEqual([
      { start: '12:00', end: '14:00' },
      { start: '16:00', end: '18:00' },
    ]);
  });
  it('ignores what falls outside the window', () => {
    expect(gaps({ start: '12:00', end: '18:00' }, [{ start: '07:00', end: '13:00' }])).toEqual([{ start: '13:00', end: '18:00' }]);
  });
});

describe('absenceGaps', () => {
  it('lists only the days with something uncovered', () => {
    const covered = [
      { cover_date: '2026-10-12', start_time: '08:00:00', end_time: '18:00:00' },
      { cover_date: '2026-10-13', start_time: '08:00:00', end_time: '18:00:00' },
      { cover_date: '2026-10-14', start_time: '08:00:00', end_time: '12:00:00' },
      { cover_date: '2026-10-14', start_time: '12:00:00', end_time: '16:00:00' },
      { cover_date: '2026-10-15', start_time: '08:00:00', end_time: '18:00:00' },
      { cover_date: '2026-10-16', start_time: '08:00:00', end_time: '18:00:00' },
    ];
    expect(absenceGaps(week, DEFAULT_HOURS, covered)).toEqual([{ date: '2026-10-14', gaps: [{ start: '16:00', end: '18:00' }] }]);
  });
});

describe('coverageConflicts', () => {
  const candidate = { date: '2026-10-14', start: '08:00', end: '18:00' };
  it('warns when the person is away that day', () => {
    expect(coverageConflicts(candidate, [{ start_date: '2026-10-14', end_date: '2026-10-14', first_day: 'full', last_day: 'full' }], [], DEFAULT_HOURS)).toEqual([
      { kind: 'away', start: '00:00', end: '23:59' },
    ]);
  });
  it('lets someone away only in the afternoon cover the morning', () => {
    const afternoon = { start_date: '2026-10-14', end_date: '2026-10-14', first_day: 'afternoon' as const, last_day: 'full' as const };
    expect(coverageConflicts({ ...candidate, end: '12:00' }, [afternoon], [], DEFAULT_HOURS)).toEqual([]);
    expect(coverageConflicts(candidate, [afternoon], [], DEFAULT_HOURS)).toHaveLength(1);
  });
  it('warns when they already cover someone then, but not for the period being changed', () => {
    const theirs = [{ id: 'x', cover_date: '2026-10-14', start_time: '10:00:00', end_time: '14:00:00', covering: 'Mariana' }];
    expect(coverageConflicts(candidate, [], theirs, DEFAULT_HOURS)).toEqual([{ kind: 'busy', start: '10:00', end: '14:00', covering: 'Mariana' }]);
    expect(coverageConflicts({ ...candidate, id: 'x' }, [], theirs, DEFAULT_HOURS)).toEqual([]);
    expect(coverageConflicts({ ...candidate, start: '14:00' }, [], theirs, DEFAULT_HOURS)).toEqual([]);
  });
});
