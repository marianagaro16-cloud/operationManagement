import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { countReminders, listReminders, REMINDER_PAGE_SIZE } from '@/server/reminders';
import { isLinkType } from '@/domain/reminders/links';
import { ReminderList } from '@/components/reminders/reminder-list';
import { REMINDER_VIEWS, type ReminderFilters, type ReminderView } from '@/types/reminders';
import { canUseReminders } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');

/**
 * The Reminders section.
 *
 * Gated on the capability here as well as in the nav, because a hidden link
 * leaves the route reachable. RLS is still what decides which rows exist.
 */
export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const viewer = await getViewer();
  if (!viewer || !canUseReminders(viewer)) redirect('/dashboard');

  // Anything unrecognised in a hand-edited URL is dropped rather than passed on.
  const filters: ReminderFilters = {
    view: REMINDER_VIEWS.includes(searchParams.view as ReminderView) ? (searchParams.view as ReminderView) : 'today',
    q: searchParams.q?.trim().slice(0, 100) || undefined,
    link: searchParams.link === 'none' || isLinkType(searchParams.link) ? searchParams.link : undefined,
    scope: searchParams.scope === 'personal' || searchParams.scope === 'shared' ? searchParams.scope : undefined,
    creator: searchParams.creator === 'me' || searchParams.creator === 'others' ? searchParams.creator : undefined,
    from: isDate(searchParams.from) ? searchParams.from : undefined,
    to: isDate(searchParams.to) ? searchParams.to : undefined,
    page: Math.max(1, Math.min(1000, Number(searchParams.page) || 1)),
  };

  const [page, today, overdue] = await Promise.all([
    listReminders(filters),
    // Counts only for the two tabs that mean "act now", and only counts.
    countReminders('today'),
    countReminders('overdue'),
  ]);

  return (
    <ReminderList
      rows={page.rows}
      total={page.total}
      pageSize={REMINDER_PAGE_SIZE}
      filters={filters}
      counts={{ today, overdue }}
      viewerId={viewer.profile.id}
      nowIso={new Date().toISOString()}
    />
  );
}
