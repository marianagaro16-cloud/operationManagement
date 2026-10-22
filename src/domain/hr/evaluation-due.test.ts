import { describe, expect, it } from 'vitest';
import { lastEvaluations, nextEvaluation, plusMonths } from './evaluation-due';

describe('next evaluation', () => {
  it('adds months, keeping to the month', () => {
    expect(plusMonths('2026-04-15', 6)).toBe('2026-10-15');
    expect(plusMonths('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('takes the latest of either kind', () => {
    const last = lastEvaluations(
      [{ worker_id: 'ana', evaluated_on: '2026-03-01' }],
      [{ worker_id: 'ana', created_at: '2026-05-10T08:00:00Z' }, { worker_id: 'bo', created_at: '2026-01-02T08:00:00Z' }],
    );
    expect(last.get('ana')).toBe('2026-05-10');
    expect(last.get('bo')).toBe('2026-01-02');
  });

  it('counts from the last evaluation, else the trial end, else the start', () => {
    const intervals = { production: 6 };
    const w = { team: 'production' as const, start_date: '2026-01-10', trial_end_date: null };
    expect(nextEvaluation(w, '2026-05-10', intervals)).toBe('2026-11-10');
    expect(nextEvaluation({ ...w, trial_end_date: '2026-04-09' }, null, intervals)).toBe('2026-04-09');
    expect(nextEvaluation(w, null, intervals)).toBe('2026-07-10');
    expect(nextEvaluation({ ...w, team: 'sales' }, null, intervals)).toBeNull();
    expect(nextEvaluation({ ...w, start_date: null }, null, intervals)).toBeNull();
  });
});
