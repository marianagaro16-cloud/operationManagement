import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getCustomerTypes, getProspectLists, getProspects, getQuietCustomers, getSalesCustomers, getSalesPeople, getSalesReport, getStartPoint, getVisitDay, getVisitablePlaces } from '@/server/sales';
import { VisitsView } from '@/components/sales/visits';
import { SalesReportView } from '@/components/sales/sales-report';
import { SalesCustomerList } from '@/components/sales/sales-customer-list';
import { QuietCustomerList } from '@/components/sales/quiet-customers';
import { ProspectList } from '@/components/sales/prospect-list';
import { SalesHeader, type SalesTab } from '@/components/sales/sales-header';
import { isSales } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const TABS: SalesTab[] = ['customers', 'quiet', 'prospects', 'visits', 'report'];

/** Sales: every customer, those going quiet, and prospects. The Ventas team, Admin and Owners. */
export default async function SalesPage({ searchParams }: { searchParams: { tab?: string; month?: string; date?: string; person?: string } }) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  const tab = TABS.includes(searchParams.tab as SalesTab) ? (searchParams.tab as SalesTab) : 'customers';
  const today = businessToday();
  // The report's month: a chosen YYYY-MM, or the running one.
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? `${searchParams.month}-01` : `${today.slice(0, 7)}-01`;

  // Visits: a day (default today) and whose (default the viewer, when in sales).
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : today;
  const needPeople = tab === 'prospects' || tab === 'visits';

  const [customers, quiet, prospects, people, customerTypes, lists, report] = await Promise.all([
    tab === 'customers' ? getSalesCustomers() : Promise.resolve([]),
    getQuietCustomers(),
    tab === 'prospects' || tab === 'visits' ? getProspects() : Promise.resolve([]),
    needPeople ? getSalesPeople() : Promise.resolve([]),
    tab === 'prospects' ? getCustomerTypes() : Promise.resolve([]),
    tab === 'prospects' ? getProspectLists(true) : Promise.resolve({ sources: [], lostReasons: [] }),
    tab === 'report' ? getSalesReport(month) : Promise.resolve(null),
  ]);

  return (
    <>
      <SalesHeader tab={tab} quietCount={quiet.length} />
      {tab === 'quiet' && <QuietCustomerList customers={quiet} />}
      {tab === 'customers' && <SalesCustomerList customers={customers} today={today} />}
      {tab === 'visits' && (
        <VisitsTab
          date={date}
          today={today}
          person={people.some((p) => p.id === searchParams.person) ? searchParams.person! : people.some((p) => p.id === viewer.profile.id) ? viewer.profile.id : people[0]?.id}
          people={people}
          quiet={quiet}
          prospects={prospects}
        />
      )}
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

/** The Visits tab's own reads: the day, the start address, and everyone who can be visited. */
async function VisitsTab({
  date,
  today,
  person,
  people,
  quiet,
  prospects,
}: {
  date: string;
  today: string;
  person: string | undefined;
  people: { id: string; name: string }[];
  quiet: Awaited<ReturnType<typeof getQuietCustomers>>;
  prospects: Awaited<ReturnType<typeof getProspects>>;
}) {
  if (!person) return null;
  const [visits, start, places] = await Promise.all([getVisitDay(person, date), getStartPoint(person), getVisitablePlaces()]);
  return (
    <VisitsView
      date={date}
      today={today}
      salespersonId={person}
      people={people}
      visits={visits}
      start={start}
      places={places}
      quiet={quiet}
      // This person's open prospects whose next step is due by that day.
      dueProspects={prospects.filter((p) => !p.closed_at && p.owner_id === person && p.next_step_on && p.next_step_on <= date)}
    />
  );
}
