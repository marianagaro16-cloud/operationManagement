import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getCategories, getMyTeams, getTasksForAdmin, getUsers, getViewer } from '@/server/data';
import { displayName } from '@/lib/utils';
import { TaskManager } from '@/components/admin/task-manager';
import { getProducts } from '@/server/orders';
import { getEquipmentChoices } from '@/server/equipment';
import { canUseReminders } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function AdminTasksPage() {
  const [tasks, categories, viewer, users, products, equipment] = await Promise.all([
    getTasksForAdmin(),
    getCategories(),
    getViewer(),
    getUsers(),
    // What a production order can make.
    getProducts(),
    // What a maintenance activity can be about.
    getEquipmentChoices(),
  ]);

  // Every team's activities, or — for a team's manager — their own team's only.
  if (!viewer) redirect('/dashboard');
  const ownTeams = viewer.can('tasks.manage_definitions')
    ? null
    : viewer.can('tasks.manage_own_team')
      ? await getMyTeams(viewer.profile.id, viewer.profile.team)
      : redirect('/admin');

  return (
    // useSearchParams (the ?edit= deep link) requires a suspense boundary.
    <Suspense>
      <TaskManager
        tasks={ownTeams ? tasks.filter((t) => ownTeams.includes(t.team)) : tasks}
        ownTeams={ownTeams}
        categories={categories}
        people={users
          // An area's manager gives its activities to its people — and to themself.
          .filter((u) => u.status === 'approved' && (!ownTeams || ownTeams.includes(u.team) || u.id === viewer.profile.id))
          .map((u) => ({ id: u.id, name: displayName(u), team: u.team }))}
        reminderViewerId={canUseReminders(viewer) ? viewer.profile.id : null}
        products={products.map((p) => ({ id: p.id, name: p.name ?? '—' }))}
        equipment={equipment}
      />
    </Suspense>
  );
}
