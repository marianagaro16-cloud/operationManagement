import { redirect } from 'next/navigation';
import { getProfile } from '@/server/data';
import { AppShell } from '@/components/shell/app-shell';
import { AccountStatusScreen } from '@/components/shell/account-status';

/**
 * The approval gate. A pending, rejected or deactivated account never reaches
 * an operational screen. RLS enforces the same thing at the data layer, so
 * this is defence in depth rather than the only check.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect('/login');

  if (profile.status !== 'approved') {
    return <AccountStatusScreen status={profile.status} />;
  }

  return <AppShell profile={profile}>{children}</AppShell>;
}
