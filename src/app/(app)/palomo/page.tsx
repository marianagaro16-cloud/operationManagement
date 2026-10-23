import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getViewer } from '@/server/data';
import { getCosts, getLastKm, getOpenTrip, getRepairCosts, getTrips, getVehicle, getVehicleAccess } from '@/server/vehicle';
import { summarizeByMonth } from '@/domain/vehicle/summary';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { PalomoView, type PalomoTab } from '@/components/vehicle/palomo-view';
import { EmptyState } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

/** How far back the office's summary looks. */
const SUMMARY_MONTHS = 12;

/**
 * The Palomo's log (2026-10-23): for Logística (their own rounds and costs)
 * and the office (everything, and the summary). RLS draws the same line.
 */
export default async function PalomoPage({ searchParams }: { searchParams: { tab?: string; month?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const access = await getVehicleAccess(viewer);
  if (!access.office && !access.driver) redirect('/dashboard');

  const vehicle = await getVehicle();
  if (!vehicle) return <EmptyState title="—" />;

  const today = businessToday();
  const tab: PalomoTab = searchParams.tab === 'costs' ? 'costs' : searchParams.tab === 'summary' && access.office ? 'summary' : 'rounds';
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') && searchParams.month! <= today.slice(0, 7) ? searchParams.month! : today.slice(0, 7);
  const first = `${month}-01`;
  const last = DateTime.fromISO(first, { zone: BUSINESS_TZ }).endOf('month').toISODate()!;
  const since = DateTime.fromISO(today, { zone: BUSINESS_TZ }).startOf('month').minus({ months: SUMMARY_MONTHS - 1 }).toISODate()!;

  const [open, todays, lastKm, trips, costs, summary] = await Promise.all([
    getOpenTrip(vehicle.id),
    getTrips(vehicle.id, today, today),
    getLastKm(vehicle.id),
    tab === 'rounds' ? getTrips(vehicle.id, first, last) : [],
    tab === 'costs' ? getCosts(vehicle.id, first, last) : [],
    tab === 'summary'
      ? Promise.all([getTrips(vehicle.id, since, today), getCosts(vehicle.id, since, today), getRepairCosts(vehicle.id, since)]).then(([t, c, r]) =>
          summarizeByMonth(t, c, r),
        )
      : null,
  ]);

  return (
    <PalomoView
      tab={tab}
      month={month}
      vehicleName={vehicle.name}
      access={access}
      viewerId={viewer.profile.id}
      today={today}
      open={open}
      todays={todays}
      lastKm={lastKm}
      trips={trips}
      costs={costs}
      summary={summary}
    />
  );
}
