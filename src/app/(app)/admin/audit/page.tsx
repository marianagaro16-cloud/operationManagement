import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getOperationalAudit, getSecurityAudit } from '@/server/permissions';
import { AuditLog } from '@/components/admin/audit-log';

export const dynamic = 'force-dynamic';

/**
 * Two trails, two audiences.
 *
 * Operational history — who counted what, who corrected which order — is
 * management information and opens at `audit.view_operational`. The security
 * trail, which records who was given power over the system, stays admin-only
 * and is simply not fetched for anyone else.
 */
export default async function AdminAuditPage() {
  const viewer = await getViewer();
  if (!viewer?.can('audit.view_operational')) redirect('/admin');

  const canSeeSecurity = viewer.can('audit.view_security');

  const [operational, security] = await Promise.all([
    getOperationalAudit(100),
    canSeeSecurity ? getSecurityAudit(100) : Promise.resolve([]),
  ]);

  return (
    <AuditLog
      operational={operational}
      security={security}
      canSeeSecurity={canSeeSecurity}
    />
  );
}
