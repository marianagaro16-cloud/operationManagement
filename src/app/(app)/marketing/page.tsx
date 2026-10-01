import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getViewer } from '@/server/data';
import { getAllPosts, getPostChoices, getPosts } from '@/server/marketing';
import { PlanView } from '@/components/marketing/plan-view';
import { canEditMarketing, canReadMarketing } from '@/lib/authz';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** The content plan: Marketing, Admin and Owners write; Sales and Managers read. */
export default async function MarketingPage({ searchParams }: { searchParams: { month?: string; view?: string } }) {
  const viewer = await getViewer();
  if (!viewer || !canReadMarketing(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const today = businessToday();
  const view = searchParams.view === 'list' ? 'list' : 'calendar';
  const requested = DateTime.fromISO(searchParams.month ?? today, { zone: BUSINESS_TZ });
  const anchor = (requested.isValid ? requested : DateTime.fromISO(today, { zone: BUSINESS_TZ })).startOf('month');
  const from = anchor.startOf('week').toISODate()!;
  const to = anchor.endOf('month').endOf('week').toISODate()!;

  const [{ dated, undated }, all, choices] = await Promise.all([
    view === 'calendar' ? getPosts(from, to) : Promise.resolve({ dated: [], undated: [] }),
    view === 'list' ? getAllPosts() : Promise.resolve([]),
    getPostChoices(),
  ]);
  return (
    <PlanView
      view={view}
      month={anchor.toISODate()!}
      today={today}
      dated={dated}
      undated={undated}
      all={all}
      canEdit={canEditMarketing(viewer.role, viewer.profile.team)}
      choices={choices}
    />
  );
}
