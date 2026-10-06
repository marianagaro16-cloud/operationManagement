import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getArticles, getGuideAccess } from '@/server/guide';
import { ArticleEditor } from '@/components/guide/article';

export const dynamic = 'force-dynamic';

/** A new article. Its id is made here, so its images have a folder before it is saved. */
export default async function NewGuideArticlePage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const access = await getGuideAccess();
  if (!access.edit) redirect('/guide?tab=articles');
  const articles = await getArticles();
  return <ArticleEditor id={randomUUID()} article={null} topics={[...new Set(articles.map((a) => a.topic).filter(Boolean))]} />;
}
