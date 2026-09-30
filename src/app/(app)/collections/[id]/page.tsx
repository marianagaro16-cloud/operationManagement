import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getAgencies, getCase, getCollectionTeam, isCollections } from '@/server/collections';
import { CaseView } from '@/components/collections/case-view';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function CollectionCasePage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!(await isCollections())) redirect('/dashboard');
  const [found, team, agencies] = await Promise.all([getCase(params.id), getCollectionTeam(), getAgencies(true)]);
  if (!found) notFound();
  return <CaseView {...found} team={team} agencies={agencies} today={businessToday()} />;
}
