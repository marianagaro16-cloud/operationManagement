import Link from 'next/link';
import { getUnconfiguredTasks, getUsers } from '@/server/data';
import { ConfigHealth } from '@/components/admin/config-health';
import { AdminOverviewHeading } from '@/components/admin/admin-overview-heading';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const [unconfigured, users] = await Promise.all([getUnconfiguredTasks(), getUsers()]);
  const pending = users.filter((u) => u.status === 'pending');

  return (
    <>
      <AdminOverviewHeading pendingCount={pending.length} />
      <div className="space-y-4">
        <ConfigHealth unconfigured={unconfigured} />
        {pending.length > 0 && (
          <Link
            href="/admin/users"
            className="block rounded-xl border border-warn/30 bg-warn/[0.05] p-3.5 transition-colors hover:bg-warn/10"
          >
            <p className="text-[13px] font-semibold">{pending.length}</p>
            <p className="text-[12.5px] text-muted">{pending.map((u) => u.email).join(', ')}</p>
          </Link>
        )}
      </div>
    </>
  );
}
