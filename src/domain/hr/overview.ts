/**
 * The overview of everyone (2026-10-22): one row per current worker over a
 * period — arrivals, what the log says, what is still open, evaluations and
 * training. Pure, so the screen and the Excel file read the same numbers.
 */
import { agreementStatus, type AgreementResult, type WarningLevel } from './note-structure';

export const OVERVIEW_PERIODS = ['3m', '6m', '12m', 'year'] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];

/** The dates a period covers, ending today; 'year' is this calendar year. */
export function overviewRange(period: OverviewPeriod, today: string): { from: string; to: string } {
  if (period === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const months = { '3m': 3, '6m': 6, '12m': 12 }[period];
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() + 1);
  return { from: d.toISOString().slice(0, 10), to: today };
}

const LEVEL_ORDER: WarningLevel[] = ['verbal', 'written', 'final'];

export interface OverviewRow {
  workerId: string;
  name: string;
  team: string;
  late: number;
  lateUnexcused: number;
  early: number;
  warnings: number;
  /** The most serious warning in the period. */
  worstWarning: WarningLevel | null;
  recognitions: number;
  conversations: number;
  /** Now, whatever the period: follow-ups not closed. */
  openFollowUps: number;
  /** Agreements of the period's notes marked not met or only partly. */
  agreementsNotMet: number;
  lastEvaluation: string | null;
  /** Average score of the last evaluation written on the file. */
  lastScore: number | null;
  nextEvaluation: string | null;
  /** Required trainings missing or expired. */
  trainingGaps: number;
}

export interface OverviewInput {
  workers: { id: string; name: string; team: string }[];
  arrivals: { worker_id: string; arrival_date: string; kind: string | null; excused: boolean }[];
  notes: {
    worker_id: string;
    note_date: string;
    warning_level: WarningLevel | null;
    type: { structure: string } | null;
    agreements: { results: { result: AgreementResult }[] }[];
  }[];
  openFollowUps: { worker_id: string }[];
  /** Newest first is not assumed. Scores of evaluations written on the file. */
  evaluations: { worker_id: string; evaluated_on: string; scores: { score: number }[] }[];
  /** Sent to several people: they count as an evaluation on their send day. */
  requests: { worker_id: string; created_at: string }[];
  nextEvaluations: Record<string, string | null>;
  trainingGaps: Record<string, number>;
}

export function buildOverview(input: OverviewInput, range: { from: string; to: string }): OverviewRow[] {
  const inRange = (d: string) => d >= range.from && d <= range.to;
  return input.workers
    .map((w) => {
      const arrivals = input.arrivals.filter((a) => a.worker_id === w.id && inRange(a.arrival_date));
      const late = arrivals.filter((a) => (a.kind ?? 'late') === 'late');
      const notes = input.notes.filter((n) => n.worker_id === w.id && inRange(n.note_date));
      const warnings = notes.filter((n) => n.type?.structure === 'warning');
      const worst = warnings.reduce<WarningLevel | null>(
        (top, n) => (n.warning_level && (!top || LEVEL_ORDER.indexOf(n.warning_level) > LEVEL_ORDER.indexOf(top)) ? n.warning_level : top),
        null,
      );
      const evaluations = input.evaluations.filter((e) => e.worker_id === w.id).sort((a, b) => b.evaluated_on.localeCompare(a.evaluated_on));
      const sent = input.requests.filter((r) => r.worker_id === w.id).map((r) => r.created_at.slice(0, 10)).sort().reverse();
      const lastDirect = evaluations[0];
      const lastEvaluation = [lastDirect?.evaluated_on, sent[0]].filter(Boolean).sort().reverse()[0] ?? null;
      const scores = lastDirect?.scores ?? [];
      return {
        workerId: w.id,
        name: w.name,
        team: w.team,
        late: late.length,
        lateUnexcused: late.filter((a) => !a.excused).length,
        early: arrivals.length - late.length,
        warnings: warnings.length,
        worstWarning: worst,
        recognitions: notes.filter((n) => n.type?.structure === 'recognition').length,
        conversations: notes.filter((n) => n.type?.structure === 'conversation').length,
        openFollowUps: input.openFollowUps.filter((f) => f.worker_id === w.id).length,
        agreementsNotMet: notes.flatMap((n) => n.agreements).filter((a) => ['not_met', 'partly'].includes(agreementStatus(a))).length,
        lastEvaluation,
        lastScore: scores.length > 0 ? Math.round((scores.reduce((s, x) => s + x.score, 0) / scores.length) * 10) / 10 : null,
        nextEvaluation: input.nextEvaluations[w.id] ?? null,
        trainingGaps: input.trainingGaps[w.id] ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
