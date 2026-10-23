import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getProductionLines, getProductionPlans } from '@/server/production-plans';
import { PlanList } from '@/components/production-plans/plan-list';
import { productionPlanAccess } from '@/lib/authz';
import { addDays, businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Production plans (2026-10-23): the Plan de Producción sheets, by day and
 * line. Planners see two months back and everything ahead; Production's users
 * the plans of today (RLS gives them nothing else).
 */
export default async function ProductionPlansPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const access = productionPlanAccess(viewer.role, viewer.profile.team, viewer.can('production_plans.manage'));
  if (!access) redirect('/dashboard');

  const today = businessToday();
  const [lines, plans] = await Promise.all([
    getProductionLines(),
    getProductionPlans(access === 'today' ? today : addDays(today, -60), access === 'today' ? today : addDays(today, 365)),
  ]);
  return <PlanList lines={lines} plans={plans} today={today} canPlan={access === 'plan'} />;
}
