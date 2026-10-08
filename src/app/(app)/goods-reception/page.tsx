import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import {
  getReceptionProducts,
  getReceptions,
  getSuppliers,
  getTransporters,
  isReceptionAssignee,
} from '@/server/goods-reception';
import { getExpectedAccess, getExpectedHistory, getOpenExpected } from '@/server/expected-deliveries';
import { ReceptionList } from '@/components/goods-reception/reception-list';
import { ExpectedList } from '@/components/goods-reception/expected-list';
import { businessToday } from '@/lib/datetime';
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
 * Whoever sees the expected deliveries — the office and the reception list —
 * gets two tabs and lands on what is coming; everyone else gets the list of
 * what arrived, as always.
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

  const access = await getExpectedAccess(viewer);
  const canManageAll = viewer.can('goods_reception.manage_all');
  // A link carrying filters and no tab is a link into what arrived.
  const filtering = Object.keys(searchParams).some((key) => key !== 'tab' && key !== 'show');
  const tab = access.see && (one('tab') === 'expected' || (!one('tab') && !filtering)) ? 'expected' : 'received';

  if (tab === 'expected') {
    const [open, history, suppliers, transporters, products, assignee] = await Promise.all([
      getOpenExpected(),
      one('show') === 'history' ? getExpectedHistory() : null,
      getSuppliers(true),
      getTransporters(true),
      access.manage ? getReceptionProducts() : [],
      isReceptionAssignee(viewer.profile.id),
    ]);
    return (
      <ExpectedList
        open={open}
        history={history}
        today={businessToday()}
        suppliers={suppliers}
        transporters={transporters}
        products={products}
        canManage={access.manage}
        canRegister={assignee || canManageAll}
      />
    );
  }

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

  const [receptions, suppliers, transporters, users, assignee, expected] = await Promise.all([
    getReceptions(filters, page),
    // Inactive suppliers are included so a filter on a deactivated one still
    // resolves — history keeps them, and a filter that cannot name them would
    // make those receptions unreachable.
    getSuppliers(true),
    getTransporters(true),
    getUsers(),
    isReceptionAssignee(viewer.profile.id),
    access.see ? getOpenExpected() : null,
  ]);

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
      expected={expected}
    />
  );
}
