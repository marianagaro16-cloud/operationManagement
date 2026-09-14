import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getReminderAttentionCount } from '@/server/reminders';
import { AppShell } from '@/components/shell/app-shell';
import { AccountStatusScreen } from '@/components/shell/account-status';
import { canUseReminders } from '@/lib/authz';

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

  // The in-app signal that a reminder is due: a count on the Reminders nav
  // entry, on every screen.
  const reminderAttention = canUseReminders(viewer) ? await getReminderAttentionCount() : 0;

  return (
    <AppShell profile={viewer.profile} caps={[...viewer.caps]} reminderAttention={reminderAttention}>
      {children}
    </AppShell>
  );
}
