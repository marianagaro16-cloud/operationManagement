import { getPreparationDay } from '@/server/orders';
import { getViewer } from '@/server/data';
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

  const [day, viewer] = await Promise.all([getPreparationDay(date), getViewer()]);

  return (
    <PreparationView
      orders={day.due}
      carriedOver={day.carriedOver}
      openDays={day.openDays}
      date={date}
      canManage={viewer?.can('orders.manage') ?? false}
    />
  );
}
