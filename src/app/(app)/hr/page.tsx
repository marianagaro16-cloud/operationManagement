import { redirect } from 'next/navigation';
import { getUsers, getViewer, getMyTeams } from '@/server/data';
import { getKeys, getOpenFollowUps, getTrainingKinds, getTrainings, getWorkers } from '@/server/hr';
import { requiredTrainings } from '@/domain/hr/trainings';
import { getUpcomingHrDates } from '@/server/hr-dates';
import { getOpenChecklists, type ChecklistSummary } from '@/server/hr-checklists';
import { businessToday } from '@/lib/datetime';
import { WorkerList } from '@/components/hr/worker-list';
import { displayName } from '@/lib/utils';
import { TEAMS, incidentScope } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/**
 * Human resources: every worker with a file. Guarded here as well as by RLS,
 * which is what actually confines a Production manager to Production.
 */
export default async function HrPage({ searchParams }: { searchParams: { followups?: string } }) {
  const viewer = await getViewer();
  if (!viewer?.can('hr.manage')) redirect('/dashboard');

  const [workers, users, followUps, allKeys, upcomingDates, trainingKinds, trainings] = await Promise.all([
    getWorkers(), getUsers(), getOpenFollowUps(), getKeys(), getUpcomingHrDates(), getTrainingKinds(), getTrainings(),
  ]);
  // Per worker: the keys they hold now.
  const keys: Record<string, string[]> = {};
  for (const k of allKeys) if (k.worker_id && !k.returned_on) (keys[k.worker_id] ??= []).push(k.key_number);
  const today = businessToday();
  // Per worker: required trainings missing or expired.
  const trainingGaps: Record<string, number> = {};
  for (const w of workers) {
    const gaps = requiredTrainings(w, trainingKinds, trainings, today).filter((r) => r.status === 'missing' || r.status === 'expired').length;
    if (gaps > 0) trainingGaps[w.id] = gaps;
  }
  // Per worker: Ingreso or Salida lists with items still open.
  const checklists: Record<string, ChecklistSummary[]> = {};
  for (const s of await getOpenChecklists(workers, trainingKinds, trainings)) (checklists[s.workerId] ??= []).push(s);
  // Per worker: a follow-up is open, or one is already late.
  const open: Record<string, 'open' | 'overdue'> = {};
  for (const f of followUps) if (open[f.worker_id] !== 'overdue') open[f.worker_id] = f.due_on < today ? 'overdue' : 'open';
  // Same scope as incidents: a Production manager files Production's people.
  const scope = incidentScope(viewer.role, viewer.profile.team);

  return (
    <WorkerList
      workers={workers}
      followUps={open}
      keys={keys}
      onlyFollowUps={searchParams.followups === '1'}
      upcomingDates={upcomingDates}
      trainingGaps={trainingGaps}
      checklists={checklists}
      accounts={users
        // Nobody files themselves: their own file would be hidden from them.
        .filter((u) => u.status === 'approved' && u.id !== viewer.profile.id)
        .map((u) => ({ id: u.id, name: displayName(u), team: u.team }))}
      teams={scope ? await getMyTeams(viewer.profile.id, viewer.profile.team) : [...TEAMS]}
    />
  );
}
