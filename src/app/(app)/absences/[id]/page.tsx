import { notFound, redirect } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { isAbsenceApprover } from '@/server/absences';
import { getAbsenceBrief, getCoverageFor, getNeedsCoverIds, getWorkingHours } from '@/server/coverage';
import { requiredWindow, workingDays } from '@/domain/absences/coverage';
import { CoveragePlanner } from '@/components/absences/coverage-planner';
import { Handover } from '@/components/absences/handover';
import { canSeeHandover, getHandover, getHandoverSuggestions } from '@/server/handover';
import { displayName } from '@/lib/utils';
import { PERMISSIONS, isAdminRole, isConfigurable } from '@/lib/authz';
import type { AbsenceStatus } from '@/types/absences';

export const dynamic = 'force-dynamic';

/**
 * One absence's coverage. Everyone may look (who is away, who covers when);
 * approvers and the absent person plan it — RLS enforces the same.
 */
export default async function AbsenceCoveragePage({ params }: { params: { id: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const [brief, coverage, needs, hours, approver, users] = await Promise.all([
    getAbsenceBrief(params.id),
    getCoverageFor(params.id),
    getNeedsCoverIds(),
    getWorkingHours(),
    isAbsenceApprover(),
    getUsers(),
  ]);
  if (!brief) notFound();

  // The handover: the absent person, the approvers and whoever covers it.
  const access = await canSeeHandover(brief.id);
  const own = brief.profile_id === viewer.profile.id;
  const [handover, suggestions] = await Promise.all([
    access.see ? getHandover(brief.id) : null,
    own ? getHandoverSuggestions(brief.profile_id, brief.start_date, brief.end_date) : [],
  ]);

  const days = workingDays(brief, hours)
    .map((date) => ({ date, window: requiredWindow(brief, date, hours) }))
    .filter((d): d is { date: string; window: { start: string; end: string } } => !!d.window);

  return (
    <>
      <CoveragePlanner
        absence={brief}
        status={brief.status as AbsenceStatus}
        days={days}
        coverage={coverage}
        // Anyone with an account can cover — except the person who is away.
        people={users
          .filter((u) => u.status === 'approved' && u.id !== brief.profile_id)
          .map((u) => ({ id: u.id, name: displayName(u) }))}
        canPlan={approver || brief.profile_id === viewer.profile.id}
        needsCover={needs.includes(brief.profile_id)}
        // Operational only. An approver gives any; the absent person only what they hold.
        grantable={PERMISSIONS.filter(
          (p) => isConfigurable(p) && (approver || isAdminRole(viewer.role) || viewer.caps.has(p)),
        )}
      />
      {handover && (
        <Handover
          absenceId={brief.id}
          items={handover.items}
          lastSent={handover.lastSent}
          canWrite={access.write}
          suggestions={suggestions}
        />
      )}
    </>
  );
}
