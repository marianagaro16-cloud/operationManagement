import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getCustomerTypes, getProspectLists, getProspects, getQuietCustomers, getSalesCustomers, getSalesPeople, getSalesReport } from '@/server/sales';
import { SalesReportView } from '@/components/sales/sales-report';
import { SalesCustomerList } from '@/components/sales/sales-customer-list';
import { QuietCustomerList } from '@/components/sales/quiet-customers';
import { ProspectList } from '@/components/sales/prospect-list';
import { SalesHeader, type SalesTab } from '@/components/sales/sales-header';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const TABS: SalesTab[] = ['customers', 'quiet', 'prospects', 'report'];

/** Sales: every customer, those going quiet, and prospects. The Ventas team, Admin and Owners. */
export default async function SalesPage({ searchParams }: { searchParams: { tab?: string; month?: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const tab = TABS.includes(searchParams.tab as SalesTab) ? (searchParams.tab as SalesTab) : 'customers';
  const today = businessToday();
  // The report's month: a chosen YYYY-MM, or the running one.
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? `${searchParams.month}-01` : `${today.slice(0, 7)}-01`;

  const [customers, quiet, prospects, people, customerTypes, lists, report] = await Promise.all([
    tab === 'customers' ? getSalesCustomers() : Promise.resolve([]),
    getQuietCustomers(),
    tab === 'prospects' ? getProspects() : Promise.resolve([]),
    tab === 'prospects' ? getSalesPeople() : Promise.resolve([]),
    tab === 'prospects' ? getCustomerTypes() : Promise.resolve([]),
    tab === 'prospects' ? getProspectLists(true) : Promise.resolve({ sources: [], lostReasons: [] }),
    tab === 'report' ? getSalesReport(month) : Promise.resolve(null),
  ]);

  return (
    <>
      <SalesHeader tab={tab} quietCount={quiet.length} />
      {tab === 'quiet' && <QuietCustomerList customers={quiet} />}
      {tab === 'customers' && <SalesCustomerList customers={customers} today={today} />}
      {tab === 'report' && report && (
        <SalesReportView
          report={report}
          month={month}
          // Every month since history began, the running one first.
          months={[...new Set([`${today.slice(0, 7)}-01`, ...report.trend.map((m) => m.month)])].sort().reverse()}
        />
      )}
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
