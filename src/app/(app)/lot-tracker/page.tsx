import { redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { searchLotAllocations, type LotSort } from '@/server/lot-tracker';
import { LotTrackerView } from '@/components/orders/lot-tracker-view';

export const dynamic = 'force-dynamic';

const SORTS: LotSort[] = ['recent', 'preparation', 'delivery', 'lot', 'customer', 'product'];
const PAGE_SIZE = 50;

interface SearchParams {
  lot?: string;
  product?: string;
  code?: string;
  customer?: string;
  ref?: string;
  prepFrom?: string;
  prepTo?: string;
  delFrom?: string;
  delTo?: string;
  user?: string;
  sort?: string;
  page?: string;
}

/**
 * Lot Nummer Tracker.
 *
 * Read-only by construction: there is no action on this route that writes
 * anything. A wrong allocation is corrected where it was entered, through the
 * order and Lotnummerkontrol, which is what keeps one source of truth.
 *
 * Filters live in the URL so a search can be sent to a colleague, reloaded,
 * and paged without losing what was typed.
 */
export default async function LotTrackerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Admin, manager and power user. Hiding the nav item would leave the route
  // reachable by URL, and the query layer checks the same capability again on
  // every call — see canUseLotTracker.
  const viewer = await getViewer();
  if (!viewer?.can('orders.manage')) redirect('/dashboard');

  const page = Math.max(Number(searchParams.page) || 1, 1);
  const sort = SORTS.includes(searchParams.sort as LotSort)
    ? (searchParams.sort as LotSort)
    : 'recent';

  const filters = {
    lot: searchParams.lot,
    product: searchParams.product,
    productCode: searchParams.code,
    customer: searchParams.customer,
    reference: searchParams.ref,
    preparedFrom: searchParams.prepFrom,
    preparedTo: searchParams.prepTo,
    deliveredFrom: searchParams.delFrom,
    deliveredTo: searchParams.delTo,
    userId: searchParams.user,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const [result, users] = await Promise.all([
    searchLotAllocations(filters),
    getUsers(),
  ]);

  return (
    <LotTrackerView
      result={result}
      users={users.map((u) => ({ id: u.id, label: u.name ?? u.email }))}
      filters={{
        lot: searchParams.lot ?? '',
        product: searchParams.product ?? '',
        code: searchParams.code ?? '',
        customer: searchParams.customer ?? '',
        ref: searchParams.ref ?? '',
        prepFrom: searchParams.prepFrom ?? '',
        prepTo: searchParams.prepTo ?? '',
        delFrom: searchParams.delFrom ?? '',
        delTo: searchParams.delTo ?? '',
        user: searchParams.user ?? '',
        sort,
      }}
      page={page}
      pageSize={PAGE_SIZE}
    />
  );
}
