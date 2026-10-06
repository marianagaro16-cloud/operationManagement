import { notFound, redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getUsers, getViewer, getMyTeams } from '@/server/data';
import { getCriteria, getArrivalSettings, getEvalTemplates, getLateArrivals, getLateReasons, getNoteTypes, getWorkerFile, getWorkerStats, getWorkers } from '@/server/hr';
import { getWorkerEvalRequests } from '@/server/hr-evaluations';
import { WorkerFile, type HrTab } from '@/components/hr/worker-file';
import { displayName } from '@/lib/utils';
import { TEAMS, incidentScope, isAdminRole } from '@/lib/authz';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const TABS: HrTab[] = ['log', 'late', 'evaluations', 'app'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function WorkerFilePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string; from?: string; to?: string };
}) {
  const viewer = await getViewer();
  if (!viewer?.can('hr.manage')) redirect('/dashboard');

  const file = await getWorkerFile(params.id);
  // Not found and not theirs to see look the same: RLS returned nothing.
  if (!file) notFound();

  const tab = TABS.includes(searchParams.tab as HrTab) ? (searchParams.tab as HrTab) : 'log';
  const today = businessToday();

  // What an evaluation reviews: by default everything since the last one, or
  // since they started, or the last year for someone with neither.
  const defaultFrom =
    file.evaluations[0]?.evaluated_on ??
    file.worker.start_date ??
    DateTime.fromISO(today, { zone: BUSINESS_TZ }).minus({ years: 1 }).toISODate()!;
  const from = searchParams.from && ISO.test(searchParams.from) ? searchParams.from : defaultFrom;
  const to = searchParams.to && ISO.test(searchParams.to) ? searchParams.to : today;

  const [noteTypes, criteria, users, workers, stats, evalRequests, templates, lateArrivals, lateReasons, arrivalSettings] = await Promise.all([
    getNoteTypes(),
    getCriteria(),
    getUsers(),
    getWorkers(),
    tab === 'app' && file.worker.profile_id ? getWorkerStats(file.worker.id, from, to) : Promise.resolve(null),
    tab === 'evaluations' ? getWorkerEvalRequests(file.worker.id) : Promise.resolve([]),
    getEvalTemplates(),
    // Counted on the tab, and summed on Evaluations.
    getLateArrivals(file.worker.id),
    tab === 'late' ? getLateReasons() : Promise.resolve([]),
    tab === 'late' ? getArrivalSettings() : Promise.resolve(null),
  ]);

  // An account can have one file; offer those still free, and this worker's own.
  const linkedElsewhere = new Set(
    workers.filter((w) => w.id !== file.worker.id && w.profile_id).map((w) => w.profile_id),
  );
  const scope = incidentScope(viewer.role, viewer.profile.team);

  // Who can be named on a note: everyone with a file the viewer may see, and
  // every account without one. An account and its file are one person.
  const filed = new Set(workers.map((w) => w.profile_id).filter(Boolean));
  const people = [
    ...workers.map((w) => ({ profile_id: w.profile_id, worker_id: w.id, name: w.name })),
    ...users
      .filter((u) => u.status === 'approved' && !filed.has(u.id))
      .map((u) => ({ profile_id: u.id, worker_id: null, name: displayName(u) })),
  ]
    .filter((p) => p.profile_id !== viewer.profile.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <WorkerFile
      file={file}
      tab={tab}
      noteTypes={noteTypes}
      criteria={criteria.filter((c) => c.team === file.worker.team)}
      templates={templates.filter((tpl) => tpl.team === file.worker.team)}
      stats={stats}
      period={{ from, to }}
      accounts={users
        .filter((u) => u.status === 'approved' && !linkedElsewhere.has(u.id) && u.id !== viewer.profile.id)
        .map((u) => ({ id: u.id, name: displayName(u), team: u.team }))}
      teams={scope ? await getMyTeams(viewer.profile.id, viewer.profile.team) : [...TEAMS]}
      today={today}
      evalRequests={evalRequests}
      isAdmin={isAdminRole(viewer.role)}
      lateArrivals={lateArrivals}
      lateReasons={lateReasons}
      viewerId={viewer.profile.id}
      viewerName={displayName(viewer.profile)}
      people={people}
      earlyTolerance={arrivalSettings?.hr_early_tolerance_minutes}
    />
  );
}
