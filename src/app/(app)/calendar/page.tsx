import { DateTime } from 'luxon';
import { getOccurrencesInRange, ensureOccurrences } from '@/server/data';
import { BUSINESS_TZ, businessToday, toBusinessDate } from '@/lib/datetime';
import { CalendarView } from '@/components/calendar/calendar-view';
import { CalendarHeading } from '@/components/calendar/calendar-heading';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
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
