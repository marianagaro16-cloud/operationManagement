import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getActivityKinds } from '@/server/sales';
import { getActa, getActaTopics } from '@/server/sales-actas';
import { PrintActa } from '@/components/sales/print-acta';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** A registered Acta on a plain page, without the app around it, to print or save as PDF. */
export default async function PrintActaRoute({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const [acta, topics, kinds] = await Promise.all([getActa(params.id), getActaTopics(true), getActivityKinds(true)]);
  if (!acta?.registered_at) notFound();
  return <PrintActa acta={acta} topics={topics} kinds={kinds} today={businessToday()} />;
}
