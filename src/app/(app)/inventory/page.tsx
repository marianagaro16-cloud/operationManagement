import { getUsers, getViewer } from '@/server/data';
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

  // History is paged, never loaded whole: it grows for as long as the
  // operation runs, and a phone on the warehouse floor must not fetch it all.
  const take = Math.min(Number(searchParams.take) || 25, 200);
  const week = Number(searchParams.week);

  const [dashboard, history, templates, users] = await Promise.all([
    getInventoryDashboard(21),
    getInventories({
      templateId: searchParams.template,
      status: STATUSES.includes(searchParams.status as InventoryStatus)
        ? (searchParams.status as InventoryStatus)
        : undefined,
      isoWeek: Number.isFinite(week) && week >= 1 && week <= 53 ? week : undefined,
      from: searchParams.from || undefined,
      to: searchParams.to || undefined,
      assignedUserId: searchParams.user || undefined,
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
          upcoming: dashboard.upcoming,
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
        users={users}
        canManage={canManage}
      />
    </>
  );
}
