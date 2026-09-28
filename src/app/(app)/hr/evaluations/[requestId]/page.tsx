import { notFound, redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getEvalRequest } from '@/server/hr-evaluations';
import { getWorkerFile } from '@/server/hr';
import { EvalRequestView } from '@/components/hr/eval-request-view';
import { displayName } from '@/lib/utils';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** One sent evaluation: the overview for whoever sees the file, and its management for Admin. */
export default async function EvalRequestPage({ params }: { params: { requestId: string } }) {
  const viewer = await getViewer();
  if (!viewer?.can('hr.manage')) redirect('/dashboard');
  const isAdmin = viewer.role === 'admin';

  const detail = await getEvalRequest(params.requestId, isAdmin);
  if (!detail) notFound();

  let people: { id: string; name: string; team: 'production' | 'operations' }[] = [];
  if (isAdmin) {
    const [users, file] = await Promise.all([getUsers(), getWorkerFile(detail.request.worker_id)]);
    const invited = new Set((detail.assignments ?? []).map((a) => a.evaluator_id));
    people = users
      .filter((u) => u.status === 'approved' && !invited.has(u.id) && u.id !== file?.worker.profile_id)
      .map((u) => ({ id: u.id, name: displayName(u), team: u.team }));
  }

  return <EvalRequestView detail={detail} isAdmin={isAdmin} people={people} today={businessToday()} />;
}
