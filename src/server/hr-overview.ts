import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { businessToday } from '@/lib/datetime';
import { buildOverview, overviewRange, type OverviewPeriod, type OverviewRow } from '@/domain/hr/overview';
import { requiredTrainings } from '@/domain/hr/trainings';
import type { AgreementResult, WarningLevel } from '@/domain/hr/note-structure';
import { getEvalDueMap } from './hr-dates';
import { getOpenFollowUps, getTrainingKinds, getTrainings, getWorkers } from './hr';

/*
 * The overview of everyone (2026-10-22). Read as the viewer: RLS gives a
 * Production manager Production's people only and hides the Owners' files,
 * exactly as the list does.
 */

type RawNote = {
  worker_id: string;
  note_date: string;
  warning_level: WarningLevel | null;
  type: { structure: string } | null;
  agreements: { results: { result: AgreementResult; followup: { created_at: string } | null }[] }[];
};

export async function getHrOverview(period: OverviewPeriod): Promise<{ rows: OverviewRow[]; from: string; to: string }> {
  const today = businessToday();
  const range = overviewRange(period, today);
  const supabase = createClient();
  const [workers, followUps, trainingKinds, trainings, nextEvaluations, { data: arrivals }, { data: notes }, { data: evaluations }, { data: requests }] = await Promise.all([
    getWorkers(),
    getOpenFollowUps(),
    getTrainingKinds(),
    getTrainings(),
    getEvalDueMap(),
    supabase.from('hr_late_arrivals').select('worker_id, arrival_date, kind, excused').gte('arrival_date', range.from).lte('arrival_date', range.to),
    supabase
      .from('hr_notes')
      .select(`
        worker_id, note_date, warning_level,
        type:hr_note_types ( structure ),
        agreements:hr_note_agreements!hr_note_agreements_note_id_fkey (
          results:hr_note_agreement_results!hr_note_agreement_results_agreement_id_fkey ( result, followup:hr_note_followups ( created_at ) )
        )
      `)
      .gte('note_date', range.from)
      .lte('note_date', range.to),
    supabase.from('hr_evaluations').select('worker_id, evaluated_on, scores:hr_evaluation_scores ( score )'),
    supabase.from('hr_eval_requests').select('worker_id, created_at'),
  ]);

  const current = workers.filter((w) => w.is_active);
  const trainingGaps: Record<string, number> = {};
  for (const w of current) {
    trainingGaps[w.id] = requiredTrainings(w, trainingKinds, trainings, today).filter((r) => r.status === 'missing' || r.status === 'expired').length;
  }
  // A follow-up's results oldest first: the latest says where the agreement stands.
  const shaped = ((notes ?? []) as unknown as RawNote[]).map((n) => ({
    ...n,
    agreements: n.agreements.map((a) => ({
      results: [...a.results].sort((x, y) => (x.followup?.created_at ?? '').localeCompare(y.followup?.created_at ?? '')),
    })),
  }));

  const rows = buildOverview(
    {
      workers: current,
      arrivals: arrivals ?? [],
      notes: shaped,
      openFollowUps: followUps,
      evaluations: (evaluations ?? []) as unknown as { worker_id: string; evaluated_on: string; scores: { score: number }[] }[],
      requests: requests ?? [],
      nextEvaluations,
      trainingGaps,
    },
    range,
  );
  return { rows, ...range };
}
