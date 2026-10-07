import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getMyTeams, getViewer } from '@/server/data';
import { getProductionOverview } from '@/server/production';
import { ProductionOverview } from '@/components/tasks/production-overview';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Production orders: what is to make in the next two weeks, and what was made in the last two months. For whoever plans Operaciones' work. */
export default async function ProductionPage() {
  const viewer = await getViewer();
  if (!viewer?.can('tasks.manage_occurrences')) redirect('/dashboard');
  // Production orders are Operaciones': an area's manager plans them only when they run it.
  if (viewer.role === 'production_manager' && !(await getMyTeams(viewer.profile.id, viewer.profile.team)).includes('operations')) redirect('/dashboard');
  const today = businessToday();
  const day = DateTime.fromISO(today, { zone: BUSINESS_TZ });
  const { open, made } = await getProductionOverview(today, day.plus({ days: 14 }).toISODate()!, day.minus({ months: 2 }).toISODate()!);
  return <ProductionOverview open={open} made={made} today={today} />;
}
