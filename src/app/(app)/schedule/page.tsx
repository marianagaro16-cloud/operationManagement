import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import {
  getScheduleAbsentDays,
  getScheduleKinds,
  getSchedulePattern,
  getSchedulePeople,
  getScheduleProducts,
  getScheduleWeek,
  getScheduleWeekList,
  getShiftHistory,
  getSundayDuties,
} from '@/server/schedule';
import { ScheduleView } from '@/components/schedule/schedule-view';
import { SundayRegister } from '@/components/schedule/sunday-register';
import { canReadSchedule, isAdminRole } from '@/lib/authz';
import { businessToday } from '@/lib/datetime';
import { weekStartOf } from '@/domain/schedule/schedule';

export const dynamic = 'force-dynamic';

/**
 * The weekly work schedule: Admin and Owners make it, the Production manager
 * reads it. Guarded here as well as by RLS — nobody else gets a row.
 */
export default async function SchedulePage({ searchParams }: { searchParams: { week?: string; view?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!canReadSchedule(viewer.role)) redirect('/dashboard');
  const canEdit = isAdminRole(viewer.role);
  const today = businessToday();

  // Inactive rows too: a past week still shows who was on it, in its colours.
  const [people, kinds, products] = await Promise.all([getSchedulePeople(true), getScheduleKinds(true), getScheduleProducts(true)]);

  if (searchParams.view === 'sundays') {
    return <SundayRegister duties={await getSundayDuties()} people={people} today={today} canEdit={canEdit} />;
  }

  const pattern = searchParams.week === 'pattern' && canEdit;
  const weekStart = pattern ? null : weekStartOf(/^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? '') ? (searchParams.week as string) : today);
  const [data, weeks, usual] = await Promise.all([
    weekStart ? getScheduleWeek(weekStart) : getSchedulePattern(),
    getScheduleWeekList(),
    pattern ? null : getSchedulePattern(),
  ]);
  const [absentDays, shiftsBefore] = await Promise.all([
    weekStart && data ? getScheduleAbsentDays(weekStart, people) : {},
    // The planning view is for whoever makes the schedule.
    weekStart && data && canEdit ? getShiftHistory(weekStart, kinds) : null,
  ]);

  return (
    <ScheduleView
      // What is typed into the sheet belongs to the week it was typed in.
      key={data?.week.id ?? weekStart ?? 'pattern'}
      weekStart={weekStart}
      data={data}
      weeks={weeks}
      people={people}
      kinds={kinds}
      products={products}
      absentDays={absentDays}
      shiftsBefore={shiftsBefore}
      today={today}
      canEdit={canEdit}
      hasPattern={pattern ? !!data : !!usual}
    />
  );
}
