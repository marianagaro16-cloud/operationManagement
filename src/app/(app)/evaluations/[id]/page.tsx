import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getMyEvaluation } from '@/server/hr-evaluations';
import { MyEvaluationForm } from '@/components/hr/my-evaluation';

export const dynamic = 'force-dynamic';

export default async function MyEvaluationPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const evaluation = await getMyEvaluation(params.id);
  if (!evaluation) notFound();
  return <MyEvaluationForm evaluation={evaluation} />;
}
