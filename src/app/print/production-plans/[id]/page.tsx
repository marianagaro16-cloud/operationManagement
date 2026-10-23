import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getLineProducts, getProductionLines, getProductionPlan } from '@/server/production-plans';
import { PrintPlan } from '@/components/production-plans/print-plan';
import { productionPlanAccess } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/** A plan on a plain landscape page, to print or save as PDF. Whoever may read it. */
export default async function PrintProductionPlanRoute({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!productionPlanAccess(viewer.role, viewer.profile.team, viewer.can('production_plans.manage'))) redirect('/dashboard');
  const [plan, lines, products] = await Promise.all([getProductionPlan(params.id), getProductionLines(), getLineProducts()]);
  const line = plan && lines.find((l) => l.id === plan.line_id);
  if (!plan || !line) notFound();
  return <PrintPlan line={line} plan={plan} products={products.filter((p) => p.line_id === line.id)} />;
}
