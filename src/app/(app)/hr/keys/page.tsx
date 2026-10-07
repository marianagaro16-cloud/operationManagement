import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getKeys, getWorkers } from '@/server/hr';
import { KeyRegisterPage } from '@/components/hr/key-register';
import { isAdminRole } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** The key register: every key handed over, to workers and to people without a file. */
export default async function HrKeysPage() {
  const viewer = await getViewer();
  if (!viewer?.can('hr.manage')) redirect('/dashboard');

  const [keys, workers] = await Promise.all([getKeys(), getWorkers()]);
  return (
    <KeyRegisterPage
      keys={keys}
      workers={workers.filter((w) => w.is_active).map((w) => ({ id: w.id, name: w.name }))}
      today={businessToday()}
      isAdmin={isAdminRole(viewer.role)}
    />
  );
}
