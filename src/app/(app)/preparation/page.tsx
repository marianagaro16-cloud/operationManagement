import { getOrdersForPreparation } from '@/server/orders';
import { getProfile } from '@/server/data';
import { businessToday } from '@/lib/datetime';
import { PreparationView } from '@/components/orders/preparation-view';

export const dynamic = 'force-dynamic';

export default async function PreparationPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  // Date-based, never weekday entities. Defaults to today in Europe/Zurich.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '')
    ? (searchParams.date as string)
    : businessToday();

  const [orders, profile] = await Promise.all([getOrdersForPreparation(date), getProfile()]);

  return <PreparationView orders={orders} date={date} isAdmin={profile?.role === 'admin'} />;
}
