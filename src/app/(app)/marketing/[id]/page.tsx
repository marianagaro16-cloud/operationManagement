import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getPost, getPostChoices } from '@/server/marketing';
import { PostView } from '@/components/marketing/post-view';
import { canEditMarketing, canReadMarketing } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function MarketingPostPage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer || !canReadMarketing(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const [post, choices] = await Promise.all([getPost(params.id), getPostChoices()]);
  if (!post) notFound();
  return <PostView post={post} canEdit={canEditMarketing(viewer.role, viewer.profile.team)} choices={choices} viewerId={viewer.profile.id} />;
}
