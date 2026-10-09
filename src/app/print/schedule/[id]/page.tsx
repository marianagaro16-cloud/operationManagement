import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getScheduleKinds, getSchedulePeople, getScheduleProducts, getScheduleVersion, getScheduleWeekById } from '@/server/schedule';
import { PrintSchedule } from '@/components/schedule/print-schedule';
import { canReadSchedule } from '@/lib/authz';
import { changedCells } from '@/domain/schedule/schedule';

export const dynamic = 'force-dynamic';

/**
 * A week of the schedule on a plain landscape page, to print or save as the
 * PDF that is shared. By default the week as it stands; `?v=2` a published
 * version as it was.
 */
export default async function PrintScheduleRoute({ params, searchParams }: { params: { id: string }; searchParams: { v?: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!canReadSchedule(viewer.role)) redirect('/dashboard');

  const [data, people, kinds, products] = await Promise.all([
    getScheduleWeekById(params.id),
    getSchedulePeople(true),
    getScheduleKinds(true),
    getScheduleProducts(true),
  ]);
  const weekStart = data?.week.week_start;
  if (!data || !weekStart) notFound();
  const { week } = data;

  const asked = Number(searchParams.v);
  if (Number.isInteger(asked) && asked >= 1 && asked <= week.version) {
    const [snapshot, before] = await Promise.all([getScheduleVersion(week.id, asked), asked > 1 ? getScheduleVersion(week.id, asked - 1) : null]);
    if (!snapshot) notFound();
    return (
      <PrintSchedule
        weekStart={weekStart}
        version={asked}
        draft={false}
        people={people}
        kinds={kinds}
        products={products}
        blocks={snapshot.blocks}
        header={snapshot}
        changed={[...(before ? changedCells(before.blocks, snapshot.blocks) : [])]}
      />
    );
  }

  // As it stands: yellow against the last version when it has changed since,
  // otherwise what that version changed against the one before.
  const dirty = !!data.published && changedCells(data.published.blocks, data.blocks).size > 0;
  const base = week.version === 0 ? null : dirty ? data.published : data.previous;
  return (
    <PrintSchedule
      weekStart={weekStart}
      version={dirty ? week.version + 1 : week.version}
      draft={week.version === 0 || dirty}
      people={people}
      kinds={kinds}
      products={products}
      blocks={data.blocks}
      header={week}
      changed={[...(base ? changedCells(base.blocks, data.blocks) : [])]}
    />
  );
}
