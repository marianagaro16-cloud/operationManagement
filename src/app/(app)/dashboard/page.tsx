import { getDashboardData } from '@/server/data';
import { DashboardView } from '@/components/tasks/dashboard-view';

// Always render fresh: task state changes constantly during a shift.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const data = await getDashboardData(7);
  return <DashboardView data={data} />;
}
