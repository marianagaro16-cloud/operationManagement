'use client';

import { useI18n } from '@/i18n';
import { teamLabelKey, type Team } from '@/lib/authz';
import { PageHeader } from '@/components/shell/app-shell';

/** The work plan — of every team, or of one area (from that area's menu entry). */
export function CalendarHeading({ team, paused = false }: { team?: Team; paused?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeader
        title={team ? t('admin.calendarTitleTeam', { team: t(teamLabelKey(team)) }) : t('admin.calendarTitle')}
        subtitle={t('admin.calendarSubtitle')}
      />
      {paused && (
        <p className="-mt-3 mb-4 rounded-lg border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[12.5px] font-medium text-warn">
          {t('admin.calendarPaused')}
        </p>
      )}
    </>
  );
}
