import { notFound, redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getCriteria, getWorkerFile } from '@/server/hr';
import { SendEvaluation } from '@/components/hr/send-evaluation';
import { displayName } from '@/lib/utils';
import { addDays, businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Admin sends an evaluation of this worker to several people. */
export default async function SendEvaluationPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (viewer?.role !== 'admin') redirect('/dashboard');

  const [file, criteria, users] = await Promise.all([getWorkerFile(params.id), getCriteria(), getUsers()]);
  if (!file) notFound();
  const today = businessToday();

  return (
    <SendEvaluation
      worker={file.worker}
      criteria={criteria}
      // Nobody evaluates themselves.
      people={users
        .filter((u) => u.status === 'approved' && u.id !== file.worker.profile_id)
        .map((u) => ({ id: u.id, name: displayName(u), team: u.team }))}
      defaultDeadline={addDays(today, 7)}
      today={today}
    />
  );
}
