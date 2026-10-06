import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getArticle, getGuideAccess } from '@/server/guide';
import { ArticleView } from '@/components/guide/article';

export const dynamic = 'force-dynamic';

/** One article. Not found and not the viewer's to read look the same: RLS returned nothing. */
export default async function GuideArticlePage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const [access, article] = await Promise.all([getGuideAccess(), getArticle(params.id)]);
  if (!article) notFound();
  return <ArticleView article={article} canEdit={access.edit} />;
}
