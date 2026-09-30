import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getCases, getCollectionCustomers, getCollectionTeam, isCollections } from '@/server/collections';
import { CaseList } from '@/components/collections/case-list';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Collections: the collections team only — guarded here as well as by RLS. */
export default async function CollectionsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!(await isCollections())) redirect('/dashboard');
  const tab = searchParams.tab === 'closed' ? 'closed' : 'open';
  const [cases, team, customers] = await Promise.all([getCases(tab === 'open'), getCollectionTeam(), getCollectionCustomers()]);
  return <CaseList tab={tab} cases={cases} today={businessToday()} viewerId={viewer.profile.id} team={team} customers={customers} />;
}
