import { describe, it, expect } from 'vitest';
import { bucketByDay } from './buckets';

/**
 * The rules the three dashboards used to state differently.
 */

interface Row {
  id: string;
  date: string;
  open: boolean;
}

const rules = {
  dateOf: (r: Row) => r.date,
  isOpen: (r: Row) => r.open,
};

const TODAY = '2026-09-07';

describe('bucketByDay', () => {
  it('puts everything due today in today, finished or not', () => {
    const rows: Row[] = [
      { id: 'done', date: TODAY, open: false },
      { id: 'open', date: TODAY, open: true },
    ];
    const b = bucketByDay(rows, TODAY, rules);
    expect(b.today.map((r) => r.id)).toEqual(['done', 'open']);
    expect(b.overdue).toEqual([]);
    expect(b.upcoming).toEqual([]);
  });

  it('counts a past item as overdue only while it is still open', () => {
    const rows: Row[] = [
      { id: 'late', date: '2026-09-01', open: true },
      { id: 'finished-late', date: '2026-09-01', open: false },
    ];
    const b = bucketByDay(rows, TODAY, rules);
    expect(b.overdue.map((r) => r.id)).toEqual(['late']);
  });

  it('never expires overdue work, however old', () => {
    const b = bucketByDay([{ id: 'ancient', date: '2019-01-01', open: true }], TODAY, rules);
    expect(b.overdue.map((r) => r.id)).toEqual(['ancient']);
  });

  it('excludes finished future work from upcoming', () => {
    const rows: Row[] = [
      { id: 'planned', date: '2026-09-10', open: true },
      { id: 'already-done', date: '2026-09-10', open: false },
    ];
    const b = bucketByDay(rows, TODAY, rules);
    expect(b.upcoming.map((r) => r.id)).toEqual(['planned']);
  });

  it('compares ISO dates lexically, so a year boundary is not special', () => {
    const rows: Row[] = [
      { id: 'dec', date: '2025-12-31', open: true },
      { id: 'jan', date: '2027-01-01', open: true },
    ];
    const b = bucketByDay(rows, TODAY, rules);
    expect(b.overdue.map((r) => r.id)).toEqual(['dec']);
    expect(b.upcoming.map((r) => r.id)).toEqual(['jan']);
  });

  it('handles an empty set without inventing buckets', () => {
    expect(bucketByDay([], TODAY, rules)).toEqual({ overdue: [], today: [], upcoming: [] });
  });
});
