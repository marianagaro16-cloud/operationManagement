import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getRequest } from '@/server/marketing-requests';
import { getPostChoices } from '@/server/marketing';
import { RequestView } from '@/components/marketing/requests';
import { canEditMarketing } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function MarketingRequestPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  // Not found and not theirs look the same: RLS returned nothing.
  const [request, { brands }] = await Promise.all([getRequest(params.id), getPostChoices()]);
  if (!request) notFound();
  return (
    <RequestView
      request={request}
      brands={brands}
      viewerId={viewer.profile.id}
      isMarketing={canEditMarketing(viewer.role, viewer.profile.team)}
    />
  );
}
