import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getViewer } from '@/server/data';
import { getMyProduction } from '@/server/production';
import { MyProduction } from '@/components/tasks/my-production';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** What I produced, the last three months: one's own production orders already recorded. */
export default async function MyProductionPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const today = businessToday();
  const since = DateTime.fromISO(today, { zone: BUSINESS_TZ }).minus({ months: 3 }).toISODate()!;
  return <MyProduction made={await getMyProduction(viewer.profile.id, since)} today={today} />;
}
