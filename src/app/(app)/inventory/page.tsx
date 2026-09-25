import { getUsers, getViewer } from '@/server/data';
import { inventoryOwnOnly } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';
import {
  getInventories,
  getInventoryDashboard,
  getInventoryTemplates,
} from '@/server/inventory';

import { InventoryOverview } from '@/components/inventory/inventory-overview';
import type { InventoryStatus } from '@/types/inventory';

// Counting state changes minute to minute during a shift.
export const dynamic = 'force-dynamic';

interface SearchParams {
  template?: string;
  status?: string;
  week?: string;
  from?: string;
  to?: string;
  user?: string;
  pending?: string;
  review?: string;
  take?: string;
}

const STATUSES: InventoryStatus[] = ['in_progress', 'completed', 'to_review', 'resolved'];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const viewer = await getViewer();
  // Reconciliation work — entering Inventory Digital, resolving a difference —
  // is management work, so the widgets that surface it follow the capability
  // rather than the admin role.
  const canManage = viewer?.can('inventory.manage_instances') ?? false;
  // A User on Production sees only their own inventories and not who else
  // counts them (enforced in RLS), so filtering by person has nothing to offer.
  const ownOnly = viewer ? inventoryOwnOnly(viewer.role, viewer.profile.team) : false;

  // History is paged, never loaded whole: it grows for as long as the
  // operation runs, and a phone on the warehouse floor must not fetch it all.
  const take = Math.min(Number(searchParams.take) || 25, 200);
  const week = Number(searchParams.week);

  /*
   * Somebody who counts but does not plan sees today, not the weeks ahead.
   *
   * The same rule the dashboard already applies to tasks: a forward view
   * invites working on tomorrow's list and buries what is due now. So without
   * inventory.manage_instances there is no Upcoming section, and the history
   * never reaches past today — however the date filters are set, because a
   * hand-typed "to" date is still a way to look ahead. Unfinished inventories
   * from earlier days stay: that is work still owed, not the future.
   */
  const today = businessToday();
  const capTo = (to: string | undefined) => (canManage ? to : !to || to > today ? today : to);

  const [dashboard, history, templates, users] = await Promise.all([
    getInventoryDashboard(canManage ? 21 : 0),
    getInventories({
      templateId: searchParams.template,
      status: STATUSES.includes(searchParams.status as InventoryStatus)
        ? (searchParams.status as InventoryStatus)
        : undefined,
      isoWeek: Number.isFinite(week) && week >= 1 && week <= 53 ? week : undefined,
      from: searchParams.from || undefined,
      to: capTo(searchParams.to || undefined),
      assignedUserId: ownOnly ? undefined : searchParams.user || undefined,
      digitalPending: searchParams.pending === '1',
      needsReview: searchParams.review === '1',
      limit: take,
    }),
    getInventoryTemplates(),
    getUsers(),
  ]);

  // The heading lives inside the client component: user-facing text comes
  // from the i18n dictionary, which is a client context.
  return (
    <>
      <InventoryOverview
        data={{
          today: dashboard.today,
          dueToday: dashboard.dueToday,
          overdue: dashboard.overdue,
          upcoming: canManage ? dashboard.upcoming : [],
          // Only an admin can act on either of these, so they are not fetched
          // into a regular user's payload at all.
          needsReview: canManage ? dashboard.needsReview : [],
          digitalPending: canManage ? dashboard.digitalPending : [],
          history: history.rows,
          historyTotal: history.total,
        }}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          translations: t.translations,
        }))}
        users={ownOnly ? [] : users}
        canManage={canManage}
      />
    </>
  );
}
