'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/primitives';
import { teamLabelKey, type Team } from '@/lib/authz';

export type TeamToday = { team: Team; total: number; done: number; late: number; blocked: number };

/**
 * The team's activities today, in one line per area — how many are done, late
 * or blocked — instead of everyone's list. The detail is in the area's work
 * plan, one tap away.
 */
export function TeamTodayCard({ areas }: { areas: TeamToday[] }) {
  const { t } = useI18n();
  if (areas.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold">
        <Users className="h-4 w-4 text-accent" aria-hidden />
        {t('teamToday.title')}
      </h2>
      <Card className="divide-y divide-border">
        {areas.map((a) => (
          <Link
            key={a.team}
            href={`/calendar?team=${a.team}`}
            className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2/60"
          >
            <span className="min-w-0 flex-1 text-[13.5px] font-medium">{t(teamLabelKey(a.team))}</span>
            <span className={cn('text-[13px] font-semibold tabular', a.total > 0 && a.done === a.total ? 'text-done' : 'text-fg')}>
              {t('teamToday.done', { done: a.done, total: a.total })}
            </span>
            {a.late > 0 && <span className="text-[12px] font-medium text-late">· {t('teamToday.late', { count: a.late })}</span>}
            {a.blocked > 0 && <span className="text-[12px] font-medium text-warn">· {t('teamToday.blocked', { count: a.blocked })}</span>}
          </Link>
        ))}
      </Card>
      <p className="mt-1.5 text-[11.5px] text-subtle">{t('teamToday.hint')}</p>
    </section>
  );
}
