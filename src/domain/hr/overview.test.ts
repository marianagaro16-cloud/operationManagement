import { describe, expect, it } from 'vitest';
import { buildOverview, overviewRange } from './overview';

describe('HR overview', () => {
  it('covers the chosen period, ending today', () => {
    expect(overviewRange('3m', '2026-10-22')).toEqual({ from: '2026-07-23', to: '2026-10-22' });
    expect(overviewRange('12m', '2026-10-22')).toEqual({ from: '2025-10-23', to: '2026-10-22' });
    expect(overviewRange('year', '2026-10-22')).toEqual({ from: '2026-01-01', to: '2026-10-22' });
  });

  it('counts each person over the period', () => {
    const [row] = buildOverview(
      {
        workers: [{ id: 'ana', name: 'Ana', team: 'production' }],
        arrivals: [
          { worker_id: 'ana', arrival_date: '2026-10-01', kind: 'late', excused: false },
          { worker_id: 'ana', arrival_date: '2026-10-02', kind: 'late', excused: true },
          { worker_id: 'ana', arrival_date: '2026-10-03', kind: 'early', excused: false },
          { worker_id: 'ana', arrival_date: '2025-01-01', kind: 'late', excused: false },
        ],
        notes: [
          { worker_id: 'ana', note_date: '2026-09-01', warning_level: 'verbal', type: { structure: 'warning' }, agreements: [{ results: [{ result: 'not_met' }] }] },
          { worker_id: 'ana', note_date: '2026-09-15', warning_level: 'written', type: { structure: 'warning' }, agreements: [{ results: [{ result: 'not_met' }, { result: 'met' }] }] },
          { worker_id: 'ana', note_date: '2026-09-20', warning_level: null, type: { structure: 'recognition' }, agreements: [] },
        ],
        openFollowUps: [{ worker_id: 'ana' }],
        evaluations: [
          { worker_id: 'ana', evaluated_on: '2026-03-01', scores: [{ score: 4 }, { score: 3 }] },
          { worker_id: 'ana', evaluated_on: '2025-03-01', scores: [{ score: 1 }] },
        ],
        requests: [{ worker_id: 'ana', created_at: '2026-06-01T08:00:00Z' }],
        nextEvaluations: { ana: '2026-12-01' },
        trainingGaps: { ana: 1 },
      },
      { from: '2026-01-01', to: '2026-10-22' },
    );
    expect(row).toMatchObject({
      late: 2,
      lateUnexcused: 1,
      early: 1,
      warnings: 2,
      worstWarning: 'written',
      recognitions: 1,
      openFollowUps: 1,
      agreementsNotMet: 1,
      lastEvaluation: '2026-06-01',
      lastScore: 3.5,
      nextEvaluation: '2026-12-01',
      trainingGaps: 1,
    });
  });
});
