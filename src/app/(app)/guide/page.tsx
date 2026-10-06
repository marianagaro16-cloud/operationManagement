import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getArticles, getGuide, getGuideAccess, getGuideChecks, getSupplierCards } from '@/server/guide';
import { GuideView, type GuideTab } from '@/components/guide/guide-view';
import { isoWeekday, pointsOn } from '@/domain/guide/guide';
import { businessToday } from '@/lib/datetime';
import { displayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TABS: GuideTab[] = ['days', 'articles', 'suppliers'];

/**
 * Guides: what a person does day by day, for whoever covers them. Guarded
 * here as well as by RLS, which is what opens a guide to the covering person
 * only around the days they cover.
 */
export default async function GuidePage({ searchParams }: { searchParams: { tab?: string; person?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const access = await getGuideAccess();
  if (!access.edit && access.guides.length === 0) redirect('/dashboard');

  const tab = TABS.includes(searchParams.tab as GuideTab) ? (searchParams.tab as GuideTab) : 'days';
  const today = businessToday();
  // The one asked for; else the one being covered today, one's own, the first.
  const selected =
    access.guides.find((g) => g.profile_id === searchParams.person) ??
    access.guides.find((g) => g.covering_today) ??
    access.guides.find((g) => g.profile_id === viewer.profile.id) ??
    access.guides[0];

  const [guide, articles, suppliers, users] = await Promise.all([
    selected ? getGuide(selected.profile_id) : null,
    getArticles(),
    getSupplierCards(),
    access.edit ? getUsers() : [],
  ]);
  const todayTasks = guide ? pointsOn(guide.points, isoWeekday(today)).filter((p) => p.kind === 'task') : [];
  const checks = await getGuideChecks(todayTasks.map((p) => p.id), today);

  const withGuide = new Set(access.guides.map((g) => g.profile_id));
  return (
    <GuideView
      access={access}
      tab={tab}
      guide={guide}
      people={users
        .filter((u) => u.status === 'approved' && !withGuide.has(u.id))
        .map((u) => ({ id: u.id, name: displayName(u) }))
        .sort((a, b) => a.name.localeCompare(b.name))}
      today={today}
      checks={checks}
      articles={articles}
      suppliers={suppliers}
    />
  );
}
