import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getQuietCustomers, getSalesCustomers } from '@/server/sales';
import { SalesCustomerList } from '@/components/sales/sales-customer-list';
import { QuietCustomerList } from '@/components/sales/quiet-customers';
import { SalesHeader } from '@/components/sales/sales-header';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

type Tab = 'customers' | 'quiet';

/** Sales: every customer, and those going quiet. The Ventas team, Admin and Owners. */
export default async function SalesPage({ searchParams }: { searchParams: { tab?: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const tab: Tab = searchParams.tab === 'quiet' ? 'quiet' : 'customers';

  const [customers, quiet] = await Promise.all([
    tab === 'customers' ? getSalesCustomers() : Promise.resolve([]),
    getQuietCustomers(),
  ]);

  return (
    <>
      <SalesHeader tab={tab} quietCount={quiet.length} />
      {tab === 'quiet'
        ? <QuietCustomerList customers={quiet} />
        : <SalesCustomerList customers={customers} today={businessToday()} />}
    </>
  );
}
