import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getKeys, getWorkers } from '@/server/hr';
import { KeyRegisterPage } from '@/components/hr/key-register';
import { isAdminRole } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';
import { displayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** The key register: every key handed over, to workers and to people without a file. */
export default async function HrKeysPage() {
  const viewer = await getViewer();
  if (!viewer?.can('hr.manage')) redirect('/dashboard');

  const [keys, workers, users] = await Promise.all([getKeys(), getWorkers(), getUsers()]);
  // Whom a key can be handed to: everyone with a file the viewer may open, then
  // the accounts without one — the owners, and the viewer, whose own file is hidden.
  const filed = new Set(workers.map((w) => w.profile_id).filter(Boolean));
  const holders = [
    ...workers.filter((w) => w.is_active).map((w) => ({ kind: 'worker' as const, id: w.id, name: w.name })),
    ...users
      .filter((u) => u.status === 'approved' && !filed.has(u.id))
      .map((u) => ({ kind: 'account' as const, id: u.id, name: displayName(u) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <KeyRegisterPage
      keys={keys}
      holders={holders}
      today={businessToday()}
      isAdmin={isAdminRole(viewer.role)}
    />
  );
}
