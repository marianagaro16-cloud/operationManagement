import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import {
  getReceptions,
  getSuppliers,
  getTransporters,
  isReceptionAssignee,
} from '@/server/goods-reception';
import { ReceptionList } from '@/components/goods-reception/reception-list';
import {
  isQuantityCheck,
  isReceptionCondition,
  isReceptionStatus,
} from '@/domain/goods-reception/vocabulary';
import type { ReceptionFilters } from '@/types/goods-reception';

export const dynamic = 'force-dynamic';

/**
 * Goods Reception — the list.
 *
 * §11: EVERY approved user reads this, whatever their role. What assignment
 * decides is whether the New button appears, and RLS decides it again on the
 * write itself.
 *
 * Filters arrive from the query string and are narrowed here rather than
 * trusted: an unrecognised status would otherwise reach Postgres as an
 * invalid enum value and turn a mistyped URL into a 500.
 */
export default async function GoodsReceptionPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') redirect('/dashboard');

  const one = (key: string): string | undefined => {
    const value = searchParams[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  const status = one('status');
  const condition = one('condition');
  const quantity = one('quantity');
  const incidents = one('incidents');

  const filters: ReceptionFilters = {
    search: one('q'),
    // A date filter is a whole day in Zurich, so the upper bound reaches the
    // end of it — otherwise "to: today" would exclude everything that arrived
    // after midnight this morning.
    from: one('from') ? `${one('from')}T00:00:00+02:00` : undefined,
    to: one('to') ? `${one('to')}T23:59:59+02:00` : undefined,
    supplierId: one('supplier'),
    transporterId: one('transporter'),
    receivedBy: one('receiver'),
    status: status && isReceptionStatus(status) ? status : undefined,
    condition: condition && isReceptionCondition(condition) ? condition : undefined,
    quantityCheck: quantity && isQuantityCheck(quantity) ? quantity : undefined,
    incidents: incidents === 'with' || incidents === 'without' ? incidents : undefined,
  };

  const page = Math.max(1, Number(one('page') ?? '1') || 1);

  const [receptions, suppliers, transporters, users, assignee] = await Promise.all([
    getReceptions(filters, page),
    // Inactive suppliers are included so a filter on a deactivated one still
    // resolves — history keeps them, and a filter that cannot name them would
    // make those receptions unreachable.
    getSuppliers(true),
    getTransporters(true),
    getUsers(),
    isReceptionAssignee(viewer.profile.id),
  ]);

  const canManageAll = viewer.can('goods_reception.manage_all');

  return (
    <ReceptionList
      page={receptions}
      suppliers={suppliers}
      transporters={transporters}
      receivers={users
        .filter((u) => u.status === 'approved')
        .map((u) => ({ id: u.id, name: u.name, email: u.email }))}
      canCreate={assignee || canManageAll}
      canExport={viewer.can('reports.export')}
      isAssignee={assignee}
    />
  );
}
