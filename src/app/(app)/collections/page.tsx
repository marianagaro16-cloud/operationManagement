import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getCases, getCollectionCustomers, getCollectionTeam, getPrepayCustomers, isCollections } from '@/server/collections';
import { CaseList } from '@/components/collections/case-list';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Collections: the collections team only — guarded here as well as by RLS. */
export default async function CollectionsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!(await isCollections())) redirect('/dashboard');
  const tab = searchParams.tab === 'closed' ? 'closed' : searchParams.tab === 'prepay' ? 'prepay' : 'open';
  const [cases, team, customers, prepay] = await Promise.all([
    tab === 'prepay' ? Promise.resolve([]) : getCases(tab === 'open'),
    getCollectionTeam(),
    getCollectionCustomers(),
    tab === 'prepay' ? getPrepayCustomers() : Promise.resolve([]),
  ]);
  return <CaseList tab={tab} prepay={prepay} cases={cases} today={businessToday()} viewerId={viewer.profile.id} team={team} customers={customers} />;
}
