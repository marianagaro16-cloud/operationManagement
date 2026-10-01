import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getRequests } from '@/server/marketing-requests';
import { getPostChoices } from '@/server/marketing';
import { RequestList } from '@/components/marketing/requests';
import { canEditMarketing } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Requests to Marketing: anyone asks; Marketing sees them all. */
export default async function MarketingRequestsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const tab = searchParams.tab === 'closed' ? 'closed' : 'open';
  const [requests, { brands }] = await Promise.all([getRequests(tab === 'open'), getPostChoices()]);
  return (
    <RequestList
      tab={tab}
      requests={requests}
      brands={brands}
      allRequests={canEditMarketing(viewer.role, viewer.profile.team)}
      today={businessToday()}
    />
  );
}
