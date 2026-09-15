import { redirect } from 'next/navigation';

/**
 * Preparation is now the "To prepare" tab of the Orders section. Old links —
 * bookmarks, notifications already sitting on phones — land in the right
 * place, keeping the day they pointed at.
 */
export default function PreparationPage({ searchParams }: { searchParams: { date?: string } }) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? `&date=${searchParams.date}` : '';
  redirect(`/orders?tab=to_prepare${date}`);
}
