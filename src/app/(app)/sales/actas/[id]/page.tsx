import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getActivityKinds, getSalesPeople } from '@/server/sales';
import { getActa, getActaMeeting, getActaTopics } from '@/server/sales-actas';
import { ActaPage } from '@/components/sales/acta-page';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** The Acta of one visit or appointment — for sales (RLS). Written by its salesperson or a manager. */
export default async function SalesActaPage({ params, searchParams }: { params: { id: string }; searchParams: { write?: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const [meeting, acta, topics, people, kinds] = await Promise.all([
    getActaMeeting(params.id),
    getActa(params.id),
    // Switched-off topics included: old Actas still name them.
    getActaTopics(true),
    getSalesPeople(),
    getActivityKinds(true),
  ]);
  if (!meeting) notFound();
  return (
    <ActaPage
      meeting={meeting}
      acta={acta}
      topics={topics}
      people={people}
      kinds={kinds}
      today={businessToday()}
      canChange={meeting.salesperson_id === viewer.profile.id || ['admin', 'owner', 'manager', 'power_user'].includes(viewer.role)}
      startWriting={searchParams.write === '1'}
    />
  );
}
