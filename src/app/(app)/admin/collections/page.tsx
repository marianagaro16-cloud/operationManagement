import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getAgencies, getCollectionTeam } from '@/server/collections';
import { CollectionsConfig } from '@/components/admin/collections-config';
import { displayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** Who works collections, and the agencies. Admin's alone (RLS: is_admin on the writes). */
export default async function AdminCollectionsPage() {
  const viewer = await getViewer();
  if (!viewer?.can('system.configure')) redirect('/admin');
  const [team, agencies, users] = await Promise.all([getCollectionTeam(), getAgencies(true), getUsers()]);
  return (
    <CollectionsConfig
      team={team.map((p) => p.id)}
      agencies={agencies}
      people={users.filter((u) => u.status === 'approved').map((u) => ({ id: u.id, name: displayName(u) }))}
    />
  );
}
