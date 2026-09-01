import { getOccurrencesInRange, getUsers } from '@/server/data';
import { addDays, businessToday } from '@/lib/datetime';
import { HistoryView } from '@/components/admin/history-view';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const today = businessToday();
  // A rolling 180-day window keeps the page fast; the data itself is kept
  // indefinitely and is never deleted when a task is deactivated.
  const [occurrences, users] = await Promise.all([
    getOccurrencesInRange(addDays(today, -180), today),
    getUsers(),
  ]);

  const names = Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email]));

  return <HistoryView occurrences={[...occurrences].reverse()} names={names} />;
}
