import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getLineProducts, getMaterialLots, getProductionLines, getProductionPlan, getRawMaterials } from '@/server/production-plans';
import { businessToday } from '@/lib/datetime';
import { getCustomers } from '@/server/orders';
import { PlanView } from '@/components/production-plans/plan-view';
import { productionPlanAccess } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/** One plan. Planners edit it; the Production manager and Production's users (today's) read it. */
export default async function ProductionPlanPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const access = productionPlanAccess(viewer.role, viewer.profile.team, viewer.can('production_plans.manage'));
  if (!access) redirect('/dashboard');

  const planner = access === 'plan';
  const [plan, lines, products, customers, materials, lots] = await Promise.all([
    getProductionPlan(params.id),
    getProductionLines(),
    getLineProducts(),
    planner ? getCustomers() : [],
    planner ? getRawMaterials() : [],
    planner ? getMaterialLots(businessToday()) : {},
  ]);
  const line = plan && lines.find((l) => l.id === plan.line_id);
  if (!plan || !line) notFound();

  return (
    <PlanView
      line={line}
      products={products.filter((p) => p.line_id === line.id)}
      plan={plan}
      editable={planner}
      customers={customers.map((c) => ({ id: c.id, name: c.name ?? c.company_name }))}
      materials={materials}
      lots={lots}
    />
  );
}
