import { notFound, redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getViewer } from '@/server/data';
import { getLateArrivals, getWorkerFile } from '@/server/hr';
import { PrintArrivals, type ArrivalsPeriod } from '@/components/hr/print-arrivals';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const PERIODS: ArrivalsPeriod[] = ['month', '3months', 'year', 'all'];

/** Only a worker's arrivals — late and too early — for one period, with signature lines. */
export default async function PrintArrivalsRoute({ params, searchParams }: { params: { id: string }; searchParams: { period?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!viewer.can('hr.manage')) redirect('/dashboard');
  const period = PERIODS.includes(searchParams.period as ArrivalsPeriod) ? (searchParams.period as ArrivalsPeriod) : 'month';
  const today = businessToday();
  const day = DateTime.fromISO(today);
  const from =
    period === 'month' ? day.startOf('month').toISODate()!
    : period === '3months' ? day.minus({ months: 2 }).startOf('month').toISODate()!
    : period === 'year' ? day.startOf('year').toISODate()!
    : null;

  const [file, arrivals] = await Promise.all([getWorkerFile(params.id), getLateArrivals(params.id)]);
  if (!file) notFound();
  return (
    <PrintArrivals
      worker={file.worker}
      arrivals={arrivals.filter((a) => (!from || a.arrival_date >= from) && a.arrival_date <= today)}
      period={period}
      from={from ?? arrivals.reduce<string | null>((m, a) => (!m || a.arrival_date < m ? a.arrival_date : m), null)}
      today={today}
    />
  );
}
