import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getViewer } from '@/server/data';
import {
  getActivityKinds, getCustomerTypes, getDayRoutePoints, getPlanCounts, getPlanDay, getPlanRange, getProspectLists, getProspects,
  getQuietCustomers, getSalesCustomers, getSalesPeople, getSalesReport, getVisitablePlaces,
} from '@/server/sales';
import { getMeetingsFor } from '@/server/meetings';
import { buildSummary, listSummaries } from '@/server/sales-summary';
import { getFlaggedCustomers } from '@/server/collections';
import { SummaryTab } from '@/components/summaries/summary-tab';
import { PlanningView } from '@/components/sales/planning';
import { SalesReportView } from '@/components/sales/sales-report';
import { SalesCustomerList } from '@/components/sales/sales-customer-list';
import { QuietCustomerList } from '@/components/sales/quiet-customers';
import { ProspectList } from '@/components/sales/prospect-list';
import { SalesHeader, type SalesTab } from '@/components/sales/sales-header';
import { isSales } from '@/lib/authz';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const TABS: SalesTab[] = ['customers', 'quiet', 'prospects', 'planning', 'report', 'summary'];

/**
 * Sales: every customer, those going quiet, prospects, the planning, and the
 * report. The Ventas team, Admin and Owners.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: { tab?: string; month?: string; date?: string; person?: string; from?: string; to?: string };
}) {
  const viewer = await getViewer();
  if (!viewer || !isSales(viewer.role, viewer.profile.team)) redirect('/dashboard');
  // An old link to the Visits tab lands on the planning, which replaced it.
  const asked = searchParams.tab === 'visits' ? 'planning' : searchParams.tab;
  const tab = TABS.includes(asked as SalesTab) ? (asked as SalesTab) : 'customers';
  const today = businessToday();
  // The report's month: a chosen YYYY-MM, or the running one.
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? `${searchParams.month}-01` : `${today.slice(0, 7)}-01`;
  // The planning's day: a chosen one, or today.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : today;
  const needPeople = tab === 'prospects' || tab === 'planning';
  // The summary's period: chosen, or this week.
  const isDate = (v: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
  const monday = DateTime.fromISO(today, { zone: BUSINESS_TZ }).startOf('week');
  const sumFrom = isDate(searchParams.from) ? searchParams.from! : monday.toISODate()!;
  const sumTo = isDate(searchParams.to) && searchParams.to! >= sumFrom ? searchParams.to! : monday.endOf('week').toISODate()!;

  const [customers, quiet, prospects, people, customerTypes, lists, report, kinds, summary, previousSummaries, flagged] = await Promise.all([
    tab === 'customers' ? getSalesCustomers() : Promise.resolve([]),
    getQuietCustomers(),
    tab === 'prospects' ? getProspects() : Promise.resolve([]),
    needPeople ? getSalesPeople() : Promise.resolve([]),
    tab === 'prospects' ? getCustomerTypes() : Promise.resolve([]),
    tab === 'prospects' ? getProspectLists(true) : Promise.resolve({ sources: [], lostReasons: [] }),
    tab === 'report' ? getSalesReport(month) : Promise.resolve(null),
    needPeople ? getActivityKinds(true) : Promise.resolve([]),
    tab === 'summary' ? buildSummary(sumFrom, sumTo) : Promise.resolve(null),
    tab === 'summary' ? listSummaries() : Promise.resolve([]),
    // Payments pending: a flag, nothing more.
    tab === 'customers' ? getFlaggedCustomers() : Promise.resolve(new Map<string, 'reminder' | 'pending'>()),
  ]);

  return (
    <>
      <SalesHeader tab={tab} quietCount={quiet.length} />
      {tab === 'quiet' && <QuietCustomerList customers={quiet} />}
      {tab === 'customers' && <SalesCustomerList customers={customers} today={today} flagged={Object.fromEntries(flagged)} />}
      {tab === 'planning' && (
        <PlanningTab
          date={date}
          today={today}
          person={people.some((p) => p.id === searchParams.person) ? searchParams.person! : people.some((p) => p.id === viewer.profile.id) ? viewer.profile.id : people[0]?.id}
          people={people}
          quiet={quiet}
          kinds={kinds}
          viewerId={viewer.profile.id}
          manages={['admin', 'owner', 'manager', 'power_user'].includes(viewer.role)}
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
      {tab === 'summary' && summary && (
        <SummaryTab content={summary} from={sumFrom} to={sumTo} today={today} previous={previousSummaries} />
      )}
      {tab === 'prospects' && (
        <ProspectList
          prospects={prospects}
          choices={{ people, customerTypes, ...lists, kinds, viewerId: viewer.profile.id }}
          today={today}
        />
      )}
    </>
  );
}

/** The planning's own reads: the day, the week's counts, the route's ends, and everyone who can be visited. */
async function PlanningTab({
  date,
  today,
  person,
  people,
  quiet,
  kinds,
  viewerId,
  manages,
}: {
  viewerId: string;
  /** Changes anyone's activities, not only their own. */
  manages: boolean;
  date: string;
  today: string;
  person: string | undefined;
  people: { id: string; name: string }[];
  quiet: Awaited<ReturnType<typeof getQuietCustomers>>;
  kinds: Awaited<ReturnType<typeof getActivityKinds>>;
}) {
  if (!person) return null;
  const monday = DateTime.fromISO(date, { zone: BUSINESS_TZ }).startOf('week');
  const [activities, week, counts, points, places, meetings] = await Promise.all([
    getPlanDay(person, date),
    getPlanRange(person, monday.toISODate()!, monday.plus({ days: 6 }).toISODate()!),
    getPlanCounts(person, monday.toISODate()!, monday.plus({ days: 6 }).toISODate()!),
    getDayRoutePoints(person, date),
    getVisitablePlaces(),
    getMeetingsFor(person, monday.toISODate()!, monday.plus({ days: 6 }).toISODate()!),
  ]);
  return (
    <PlanningView
      date={date}
      today={today}
      salespersonId={person}
      people={people}
      activities={activities}
      week={week}
      meetings={meetings}
      counts={counts}
      home={points.home}
      office={points.office}
      ends={points.ends}
      places={places}
      quiet={quiet}
      kinds={kinds}
      viewerId={viewerId}
      manages={manages}
    />
  );
}
