import { DateTime } from 'luxon';
import { getOccurrencesInRange, getUsers } from '@/server/data';
import { BUSINESS_TZ, businessToday, toBusinessDate } from '@/lib/datetime';
import { computeStats } from '@/domain/stats';
import { StatsView, type StatsRange } from '@/components/admin/stats-view';

export const dynamic = 'force-dynamic';

const RANGES: StatsRange[] = ['day', 'week', 'month', 'year'];

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const range: StatsRange = RANGES.includes(searchParams.range as StatsRange)
    ? (searchParams.range as StatsRange)
    : 'month';

  const today = businessToday();
  const now = DateTime.fromISO(today, { zone: BUSINESS_TZ });

  // Reporting periods are Zurich-aligned, matching how the business thinks
  // about a day, a week (ISO, Mon-Sun), a month and a year.
  const from = toBusinessDate(now.startOf(range === 'day' ? 'day' : range));
  const to = toBusinessDate(now.endOf(range === 'day' ? 'day' : range));

  const [occurrences, users] = await Promise.all([getOccurrencesInRange(from, to), getUsers()]);
  const names = new Map(users.map((u) => [u.id, u.name ?? u.email]));

  return <StatsView stats={computeStats(occurrences, today, names)} range={range} />;
}
