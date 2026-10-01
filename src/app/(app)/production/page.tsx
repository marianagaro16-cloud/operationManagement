import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getViewer } from '@/server/data';
import { getProductionOverview } from '@/server/production';
import { ProductionOverview } from '@/components/tasks/production-overview';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Production orders: what is to make in the next two weeks, and what was made in the last two months. For planners. */
export default async function ProductionPage() {
  const viewer = await getViewer();
  if (!viewer?.can('tasks.manage_occurrences')) redirect('/dashboard');
  const today = businessToday();
  const day = DateTime.fromISO(today, { zone: BUSINESS_TZ });
  const { open, made } = await getProductionOverview(today, day.plus({ days: 14 }).toISODate()!, day.minus({ months: 2 }).toISODate()!);
  return <ProductionOverview open={open} made={made} today={today} />;
}
