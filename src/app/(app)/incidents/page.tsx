import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import {
  getIncidentCategories,
  getIncidents,
  getIncidentTypes,
  INCIDENT_PAGE_SIZE,
} from '@/server/incidents';
import { getCustomers, getDeliveryMethods, getProducts } from '@/server/orders';
import {
  isCause,
  isResponsibility,
  isSeverity,
  isStatus,
} from '@/domain/incidents/vocabulary';
import { IncidentList } from '@/components/incidents/incident-list';
import type { IncidentFilters } from '@/types/incidents';

export const dynamic = 'force-dynamic';

/**
 * The incident list.
 *
 * Filters come from the URL and are narrowed here before they reach the
 * query — an unrecognised status in a hand-edited URL is dropped rather than
 * passed through to PostgREST as an enum it will reject.
 *
 * The page is NOT gated on a capability. §5 gives a plain user sight of
 * incidents on orders they personally prepared, and RLS is what decides which
 * rows those are — so an ordinary user reaching this route sees their own
 * handful, and everybody else sees everything. Creating is what needs the
 * capability, and that is checked below and again in the database.
 */
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') redirect('/dashboard');

  const filters: IncidentFilters = {
    from: isDate(searchParams.from) ? searchParams.from : undefined,
    to: isDate(searchParams.to) ? searchParams.to : undefined,
    customerId: isUuid(searchParams.customerId) ? searchParams.customerId : undefined,
    productId: isUuid(searchParams.productId) ? searchParams.productId : undefined,
    orderId: isUuid(searchParams.orderId) ? searchParams.orderId : undefined,
    categoryId: isUuid(searchParams.categoryId) ? searchParams.categoryId : undefined,
    typeId: isUuid(searchParams.typeId) ? searchParams.typeId : undefined,
    deliveryMethodId: isUuid(searchParams.deliveryMethodId) ? searchParams.deliveryMethodId : undefined,
    createdBy: isUuid(searchParams.createdBy) ? searchParams.createdBy : undefined,
    primaryCause: searchParams.primaryCause && isCause(searchParams.primaryCause)
      ? searchParams.primaryCause : undefined,
    responsibility: searchParams.responsibility && isResponsibility(searchParams.responsibility)
      ? searchParams.responsibility : undefined,
    severity: searchParams.severity && isSeverity(searchParams.severity)
      ? searchParams.severity : undefined,
    status: searchParams.status && isStatus(searchParams.status)
      ? searchParams.status : undefined,
    replacement: searchParams.replacement === 'with' || searchParams.replacement === 'without'
      ? searchParams.replacement : undefined,
    action: ['none', 'open', 'done'].includes(searchParams.action ?? '')
      ? (searchParams.action as 'none' | 'open' | 'done') : undefined,
    q: searchParams.q?.trim() || undefined,
  };

  const page = Math.max(1, Number(searchParams.page) || 1);

  const [rows, customers, products, categories, types, deliveryMethods] = await Promise.all([
    getIncidents(filters, page, INCIDENT_PAGE_SIZE),
    getCustomers(true),
    getProducts(true),
    getIncidentCategories(),
    getIncidentTypes(),
    getDeliveryMethods(true),
  ]);

  return (
    <IncidentList
      page={rows}
      filters={filters}
      customers={customers}
      products={products}
      categories={categories}
      types={types}
      deliveryMethods={deliveryMethods}
      canManage={viewer.can('incidents.manage')}
    />
  );
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value));
}

function isDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}
