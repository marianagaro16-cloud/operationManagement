import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getAbsenceApproverIds, getAbsenceTypes } from '@/server/absences';
import { AbsencesConfig } from '@/components/admin/absences-config';
import { displayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The lists behind absences: their types and who approves. Admin's alone: the
 * admin layout opens at power_user, so the page guards itself, and RLS
 * (is_admin) guards the writes.
 */
export default async function AdminAbsencesPage() {
  const viewer = await getViewer();
  if (!viewer?.can('system.configure')) redirect('/admin');

  const [types, approvers, users] = await Promise.all([getAbsenceTypes(true), getAbsenceApproverIds(), getUsers()]);
  return (
    <AbsencesConfig
      types={types}
      approvers={approvers}
      people={users.filter((u) => u.status === 'approved').map((u) => ({ id: u.id, name: displayName(u) }))}
    />
  );
}
