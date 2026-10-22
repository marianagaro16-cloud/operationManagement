import { describe, expect, it } from 'vitest';
import { allImportantDates, noticeStage, upcomingImportantDates } from './important-dates';

const workers = [
  { id: 'ana', name: 'Ana', trial_end_date: '2026-11-01', contract_end_date: null },
  { id: 'bo', name: 'Bo', trial_end_date: null, contract_end_date: '2026-12-31' },
];
const custom = [
  { id: 'c1', worker_id: 'ana', label: 'Medical check', on_date: '2026-10-20' },
  { id: 'c2', worker_id: 'gone', label: 'Not shown', on_date: '2026-10-25' },
];

describe('important dates', () => {
  it('lists every date of the given workers, soonest first', () => {
    const all = allImportantDates(workers, custom, '2026-10-22');
    expect(all.map((d) => [d.kind, d.workerName, d.daysAway])).toEqual([
      ['custom', 'Ana', -2],
      ['trial_end', 'Ana', 10],
      ['contract_end', 'Bo', 70],
    ]);
  });

  it('keeps what falls within the coming 30 days, today included', () => {
    expect(upcomingImportantDates(workers, custom, '2026-10-22').map((d) => d.kind)).toEqual(['trial_end']);
    expect(upcomingImportantDates(workers, custom, '2026-12-01').map((d) => d.kind)).toEqual(['contract_end']);
    expect(upcomingImportantDates(workers, custom, '2026-11-01').map((d) => d.kind)).toEqual(['trial_end']);
  });

  it('tells once within the 30 days before, and on the day', () => {
    expect(noticeStage(31)).toBeNull();
    expect(noticeStage(30)).toBe('before');
    expect(noticeStage(3)).toBe('before');
    expect(noticeStage(0)).toBe('day');
    expect(noticeStage(-1)).toBeNull();
  });
});
