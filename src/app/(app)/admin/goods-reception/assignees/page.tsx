import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getReceptionAssignees } from '@/server/goods-reception';
import { ReceptionAssignees } from '@/components/admin/reception-assignees';

export const dynamic = 'force-dynamic';

/**
 * Who may register an incoming delivery.
 *
 * Configuration, so it takes goods_reception.manage_config — a Manager or an
 * Admin. A Power User can correct any reception but does not decide who is
 * responsible for making them, which is the same line every other module in
 * this codebase draws between management and configuration.
 */
export default async function ReceptionAssigneesPage() {
  const viewer = await getViewer();
  if (!viewer?.can('goods_reception.manage_config')) redirect('/admin');

  const [users, assignees] = await Promise.all([getUsers(), getReceptionAssignees()]);

  return (
    <ReceptionAssignees users={users} assigned={assignees.map((a) => a.user_id)} />
  );
}
