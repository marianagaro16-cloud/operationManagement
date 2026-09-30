import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getUsers, getViewer } from '@/server/data';
import {
  getAbsenceTypes,
  getAbsences,
  getMyAbsences,
  getPendingAbsences,
  isAbsenceApprover,
} from '@/server/absences';
import { AbsencesView, type AbsenceTab } from '@/components/absences/absences-view';
import { getCoverageBetween, getMyCoverage, getNeedsCoverIds, getWorkingHours } from '@/server/coverage';
import { BUSINESS_TZ, businessToday } from '@/lib/datetime';
import { displayName } from '@/lib/utils';
import type { AbsenceStatus } from '@/types/absences';

export const dynamic = 'force-dynamic';

const STATUSES: AbsenceStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

/**
 * Absences, for everyone with an account: their own, who is away when, and —
 * for approvers — what waits for a decision and every absence. RLS decides
 * what each of those returns.
 */
export default async function AbsencesPage({
  searchParams,
}: {
  searchParams: { tab?: string; month?: string; person?: string; type?: string; status?: string; from?: string; to?: string };
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const today = businessToday();
  const approver = await isAbsenceApprover();
  const wanted = searchParams.tab as AbsenceTab | undefined;
  const tab: AbsenceTab =
    wanted === 'calendar' || wanted === 'coverage' ? wanted : (wanted === 'approve' || wanted === 'all') && approver ? wanted : 'mine';

  const monthStart = DateTime.fromISO(`${searchParams.month ?? today.slice(0, 7)}-01`, { zone: BUSINESS_TZ });
  const month = (monthStart.isValid ? monthStart : DateTime.fromISO(today, { zone: BUSINESS_TZ }).startOf('month')).toFormat('yyyy-MM');
  const first = `${month}-01`;
  const last = DateTime.fromISO(first, { zone: BUSINESS_TZ }).endOf('month').toISODate()!;

  const [types, mine, pending, monthData, all, users, myCoverage, needsCover, hours] = await Promise.all([
    getAbsenceTypes(true),
    tab === 'mine' ? getMyAbsences() : [],
    // The tab's count shows everywhere for an approver.
    approver ? getPendingAbsences() : [],
    // The month, and today for "away today".
    tab === 'calendar' ? getCoverageBetween(first < today ? first : today, last > today ? last : today) : { away: [], coverage: [] },
    tab === 'all'
      ? getAbsences({
          profileId: searchParams.person || undefined,
          typeId: searchParams.type || undefined,
          status: STATUSES.includes(searchParams.status as AbsenceStatus) ? (searchParams.status as AbsenceStatus) : undefined,
          from: searchParams.from || undefined,
          to: searchParams.to || undefined,
        })
      : [],
    tab === 'all' ? getUsers() : [],
    // The tab's count shows everywhere.
    getMyCoverage(today),
    tab === 'calendar' ? getNeedsCoverIds() : [],
    getWorkingHours(),
  ]);

  return (
    <AbsencesView
      tab={tab}
      today={today}
      viewerId={viewer.profile.id}
      approver={approver}
      types={types}
      mine={mine}
      pending={pending}
      month={month}
      calendar={monthData.away}
      coverage={monthData.coverage}
      myCoverage={myCoverage}
      needsCover={needsCover}
      hours={hours}
      all={all}
      people={users.filter((u) => u.status === 'approved').map((u) => ({ id: u.id, name: displayName(u) }))}
    />
  );
}
