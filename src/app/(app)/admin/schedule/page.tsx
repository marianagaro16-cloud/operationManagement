import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getWorkers } from '@/server/hr';
import { getScheduleKinds, getSchedulePeople, getScheduleProducts } from '@/server/schedule';
import { ScheduleConfig } from '@/components/admin/schedule-config';

export const dynamic = 'force-dynamic';

/**
 * The lists behind the schedule: who is on it, the kinds of block and the
 * products of a day. Admin's alone: the page guards itself, and RLS
 * (is_admin) guards the writes.
 */
export default async function AdminSchedulePage() {
  const viewer = await getViewer();
  if (!viewer?.can('system.configure')) redirect('/admin');

  // Inactive rows included: this is where one is switched back on.
  const [people, kinds, products, workers] = await Promise.all([getSchedulePeople(true), getScheduleKinds(true), getScheduleProducts(true), getWorkers()]);
  const onIt = new Set(people.map((p) => p.worker_id).filter(Boolean));
  return (
    <ScheduleConfig
      people={people}
      kinds={kinds}
      products={products}
      workers={workers.filter((w) => w.is_active && !onIt.has(w.id)).map((w) => ({ id: w.id, name: w.name }))}
    />
  );
}
