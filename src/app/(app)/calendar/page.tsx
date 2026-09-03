import { DateTime } from 'luxon';
import { getOccurrencesInRange, ensureOccurrences, getProfile } from '@/server/data';
import { BUSINESS_TZ, businessToday, toBusinessDate } from '@/lib/datetime';
import { CalendarView } from '@/components/calendar/calendar-view';
import { CalendarHeading } from '@/components/calendar/calendar-heading';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  // Regular users work the current day; the calendar is a planning tool.
  // Hiding the nav link alone would leave the route reachable by URL.
  const profile = await getProfile();
  if (profile?.role !== 'admin') redirect('/dashboard');

  const today = businessToday();

  const requested = searchParams.month
    ? DateTime.fromISO(searchParams.month, { zone: BUSINESS_TZ })
    : DateTime.fromISO(today, { zone: BUSINESS_TZ });
  const anchor = (requested.isValid ? requested : DateTime.fromISO(today, { zone: BUSINESS_TZ }))
    .startOf('month');

  const from = toBusinessDate(anchor.startOf('week'));
  const to = toBusinessDate(anchor.endOf('month').endOf('week'));

  // Make a future month legible by materialising the window being viewed.
  await ensureOccurrences(from, to);
  const occurrences = await getOccurrencesInRange(from, to);

  return (
    <>
      <CalendarHeading />
      <CalendarView occurrences={occurrences} month={toBusinessDate(anchor)} today={today} />
    </>
  );
}
