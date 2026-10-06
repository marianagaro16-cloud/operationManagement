import { redirect } from 'next/navigation';
import { getMyTeams, getViewer } from '@/server/data';
import { getReminderAttentionCount } from '@/server/reminders';
import { getUnreadInboxCount } from '@/server/inbox';
import { getMyEvaluationCounts } from '@/server/hr-evaluations';
import { isCollections } from '@/server/collections';
import { AppShell } from '@/components/shell/app-shell';
import { AccountStatusScreen } from '@/components/shell/account-status';
import { ChoosePasswordScreen } from '@/components/shell/choose-password';
import { canEditMarketing, canUseReminders } from '@/lib/authz';
import { countNewRequests } from '@/server/marketing-requests';
import { hasOwnProduction } from '@/server/production';
import { countNewRepairs } from '@/server/repairs';
import { getGuideAccess } from '@/server/guide';

/**
 * The approval gate. A pending, rejected or deactivated account never reaches
 * an operational screen. RLS enforces the same thing at the data layer, so
 * this is defence in depth rather than the only check.
 *
 * Resolving the viewer here rather than the bare profile means the capability
 * set is fetched once for the whole authenticated tree, and every page below
 * gets it from the same request-scoped cache.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  if (viewer.profile.status !== 'approved') {
    return <AccountStatusScreen status={viewer.profile.status} />;
  }

  // After an Admin reset the password, nothing else until they choose their own.
  if (viewer.profile.must_change_password) {
    return <ChoosePasswordScreen />;
  }

  // The in-app signal that a reminder is due: a count on the Reminders nav
  // entry, on every screen.
  // …and unread notifications, as a count on the inbox icon. Both at once.
  // …and evaluations they were asked to fill in, if ever.
  const [reminderAttention, inboxUnread, evaluations, collections, marketingNew, ownProduction, myTeams, repairsNew, guideAccess] = await Promise.all([
    canUseReminders(viewer) ? getReminderAttentionCount() : Promise.resolve(0),
    getUnreadInboxCount(),
    getMyEvaluationCounts(),
    isCollections(),
    // New requests waiting for Marketing: a count on its menu entry.
    canEditMarketing(viewer.role, viewer.profile.team) ? countNewRequests() : Promise.resolve(0),
    // Production orders of one's own: a 'My production' entry.
    hasOwnProduction(viewer.profile.id),
    getMyTeams(viewer.profile.id, viewer.profile.team),
    // New repair reports: counted for Maintenance (RLS shows anyone else only their own).
    viewer.profile.team === 'maintenance' || viewer.profile.role === 'production_manager' ? countNewRepairs() : Promise.resolve(0),
    // Guides: for who writes them, has one, or covers someone who has.
    getGuideAccess(),
  ]);

  return (
    <AppShell
      profile={viewer.profile}
      caps={[...viewer.caps]}
      reminderAttention={reminderAttention}
      inboxUnread={inboxUnread}
      evaluations={evaluations}
      collections={collections}
      marketingNew={marketingNew}
      ownProduction={ownProduction}
      myTeams={myTeams}
      repairsNew={repairsNew}
      guide={guideAccess.edit || guideAccess.guides.length > 0}
    >
      {children}
    </AppShell>
  );
}
