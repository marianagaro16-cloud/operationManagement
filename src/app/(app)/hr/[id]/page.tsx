import { notFound, redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getUsers, getViewer } from '@/server/data';
import { getCriteria, getNoteTypes, getWorkerFile, getWorkerStats, getWorkers } from '@/server/hr';
import { WorkerFile, type HrTab } from '@/components/hr/worker-file';
import { displayName } from '@/lib/utils';
import { TEAMS, incidentScope } from '@/lib/authz';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const TABS: HrTab[] = ['log', 'evaluations', 'app'];
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

  const [noteTypes, criteria, users, workers, stats] = await Promise.all([
    getNoteTypes(),
    getCriteria(),
    getUsers(),
    getWorkers(),
    tab === 'app' && file.worker.profile_id ? getWorkerStats(file.worker.id, from, to) : Promise.resolve(null),
  ]);

  // An account can have one file; offer those still free, and this worker's own.
  const linkedElsewhere = new Set(
    workers.filter((w) => w.id !== file.worker.id && w.profile_id).map((w) => w.profile_id),
  );
  const scope = incidentScope(viewer.role, viewer.profile.team);

  return (
    <WorkerFile
      file={file}
      tab={tab}
      noteTypes={noteTypes}
      criteria={criteria.filter((c) => c.team === file.worker.team)}
      stats={stats}
      period={{ from, to }}
      accounts={users
        .filter((u) => u.status === 'approved' && !linkedElsewhere.has(u.id))
        .map((u) => ({ id: u.id, name: displayName(u), team: u.team }))}
      teams={scope ? [scope] : [...TEAMS]}
      today={today}
    />
  );
}
