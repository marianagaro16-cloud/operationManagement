import { describe, expect, it } from 'vitest';
import { nextYearly, upcomingCelebrations } from './celebrations';

describe('nextYearly', () => {
  it('finds this year when still ahead, next year when past', () => {
    expect(nextYearly('1990-10-05', '2026-09-28')).toEqual({ date: '2026-10-05', years: 36 });
    expect(nextYearly('1990-03-01', '2026-09-28')).toEqual({ date: '2027-03-01', years: 37 });
  });

  it('counts today as today, not next year', () => {
    expect(nextYearly('1990-09-28', '2026-09-28')).toEqual({ date: '2026-09-28', years: 36 });
  });

  it('keeps a 29 February birthday on the 28th in a common year', () => {
    expect(nextYearly('2000-02-29', '2027-01-10')).toEqual({ date: '2027-02-28', years: 27 });
    expect(nextYearly('2000-02-29', '2028-01-10')).toEqual({ date: '2028-02-29', years: 28 });
  });
});

describe('upcomingCelebrations', () => {
  const today = '2026-09-28';
  const workers = [
    { id: 'a', name: 'Ana', birth_date: '1995-09-28', start_date: '2020-10-01' },
    { id: 'b', name: 'Bea', birth_date: '1988-10-10', start_date: null },
    { id: 'c', name: 'Carl', birth_date: null, start_date: '2026-09-30' },
    { id: 'd', name: 'Dan', birth_date: null, start_date: '2025-10-04' },
  ];

  it('lists what falls within the window, soonest first', () => {
    expect(upcomingCelebrations(workers, today, 7)).toEqual([
      { workerId: 'a', name: 'Ana', kind: 'birthday', date: '2026-09-28', daysAway: 0, years: 31 },
      { workerId: 'a', name: 'Ana', kind: 'anniversary', date: '2026-10-01', daysAway: 3, years: 6 },
      { workerId: 'd', name: 'Dan', kind: 'anniversary', date: '2026-10-04', daysAway: 6, years: 1 },
    ]);
  });

  it('leaves out what is further away', () => {
    expect(upcomingCelebrations(workers, today, 7).some((c) => c.workerId === 'b')).toBe(false);
    expect(upcomingCelebrations(workers, today, 12).some((c) => c.workerId === 'b')).toBe(true);
  });

  it('has no anniversary for a start date still ahead or under a year ago', () => {
    expect(upcomingCelebrations(workers, today, 7).some((c) => c.workerId === 'c')).toBe(false);
    expect(upcomingCelebrations([{ id: 'e', name: 'Eva', birth_date: null, start_date: '2026-01-02' }], today, 365))
      .toEqual([{ workerId: 'e', name: 'Eva', kind: 'anniversary', date: '2027-01-02', daysAway: 96, years: 1 }]);
  });
});
