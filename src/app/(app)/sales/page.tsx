import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getCustomerTypes, getProspectLists, getProspects, getQuietCustomers, getSalesCustomers, getSalesPeople } from '@/server/sales';
import { SalesCustomerList } from '@/components/sales/sales-customer-list';
import { QuietCustomerList } from '@/components/sales/quiet-customers';
import { ProspectList } from '@/components/sales/prospect-list';
import { SalesHeader, type SalesTab } from '@/components/sales/sales-header';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const TABS: SalesTab[] = ['customers', 'quiet', 'prospects'];

/** Sales: every customer, those going quiet, and prospects. The Ventas team, Admin and Owners. */
export default async function SalesPage({ searchParams }: { searchParams: { tab?: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const tab = TABS.includes(searchParams.tab as SalesTab) ? (searchParams.tab as SalesTab) : 'customers';
  const today = businessToday();

  const [customers, quiet, prospects, people, customerTypes, lists] = await Promise.all([
    tab === 'customers' ? getSalesCustomers() : Promise.resolve([]),
    getQuietCustomers(),
    tab === 'prospects' ? getProspects() : Promise.resolve([]),
    tab === 'prospects' ? getSalesPeople() : Promise.resolve([]),
    tab === 'prospects' ? getCustomerTypes() : Promise.resolve([]),
    tab === 'prospects' ? getProspectLists(true) : Promise.resolve({ sources: [], lostReasons: [] }),
  ]);

  return (
    <>
      <SalesHeader tab={tab} quietCount={quiet.length} />
      {tab === 'quiet' && <QuietCustomerList customers={quiet} />}
      {tab === 'customers' && <SalesCustomerList customers={customers} today={today} />}
      {tab === 'prospects' && (
        <ProspectList
          prospects={prospects}
          choices={{ people, customerTypes, ...lists, viewerId: viewer.profile.id }}
          today={today}
        />
      )}
    </>
  );
}
