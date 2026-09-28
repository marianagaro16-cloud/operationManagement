import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getSalesCustomers } from '@/server/sales';
import { SalesCustomerList } from '@/components/sales/sales-customer-list';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Sales: every customer. The Ventas team, Admin and Owners; the database says the same. */
export default async function SalesPage() {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  return <SalesCustomerList customers={await getSalesCustomers()} today={businessToday()} />;
}
