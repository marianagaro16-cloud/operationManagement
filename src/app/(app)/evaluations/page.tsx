import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getMyEvaluations } from '@/server/hr-evaluations';
import { MyEvaluationList } from '@/components/hr/my-evaluation';

export const dynamic = 'force-dynamic';

/** The evaluations the viewer was asked to fill in. Anyone may be asked. */
export default async function MyEvaluationsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  return <MyEvaluationList evaluations={await getMyEvaluations()} />;
}
