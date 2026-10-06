import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getArticle, getArticles, getGuideAccess } from '@/server/guide';
import { ArticleEditor } from '@/components/guide/article';

export const dynamic = 'force-dynamic';

export default async function EditGuideArticlePage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const access = await getGuideAccess();
  if (!access.edit) redirect('/guide?tab=articles');
  const [article, articles] = await Promise.all([getArticle(params.id), getArticles()]);
  if (!article) notFound();
  return <ArticleEditor id={article.id} article={article} topics={[...new Set(articles.map((a) => a.topic).filter(Boolean))]} />;
}
