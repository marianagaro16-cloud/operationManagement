'use client';

import Link from 'next/link';
import { AlertTriangle, CalendarOff } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui/primitives';
import { gaps as gapsOf, requiredWindow, type WorkingHours } from '@/domain/absences/coverage';
import type { AbsenceCalendarEntry, CoverageEntry } from '@/types/absences';
import { useAbsenceLabels } from './absence-parts';

/**
 * Who is away today and who covers them when; what is uncovered, in red.
 * Nothing when everyone is in.
 */
export function CoverageTodayCard({
  today,
  away,
  coverage,
  needsCover,
  hours,
  viewerId,
}: {
  today: string;
  away: AbsenceCalendarEntry[];
  coverage: CoverageEntry[];
  needsCover: string[];
  hours: WorkingHours;
  viewerId: string;
}) {
  const { t } = useI18n();
  const labels = useAbsenceLabels();
  if (away.length === 0) return null;
  const mine = coverage.filter((c) => c.coverer_id === viewerId);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <CalendarOff className="h-4 w-4 text-accent" aria-hidden />
          {t('coverage.today')}
        </h2>
        <Link href="/absences?tab=calendar" className="text-[12.5px] font-medium text-accent hover:underline">
          {t('coverage.seeCalendar')}
        </Link>
      </div>
      <Card className="divide-y divide-border">
        {mine.length > 0 && (
          <p className="bg-accent/[0.06] px-3.5 py-2 text-[13px] font-medium text-accent">
            {mine.map((c) => t('coverage.youCoverToday', { name: c.absent_name, times: `${c.start_time.slice(0, 5)}–${c.end_time.slice(0, 5)}` })).join(' · ')}
          </p>
        )}
        {away.map((a) => {
          const theirs = coverage.filter((c) => c.absence_id === a.id);
          const window = requiredWindow(a, today, hours);
          const open =
            needsCover.includes(a.profile_id) && window
              ? gapsOf(window, theirs.map((c) => ({ start: c.start_time.slice(0, 5), end: c.end_time.slice(0, 5) })))
              : [];
          const part = labels.partOn(a, today);
          return (
            <Link key={a.id} href={`/absences/${a.id}`} className="block px-3.5 py-2 hover:bg-surface-2">
              <p className="text-[13.5px]">
                <span className="font-medium">{a.person_name}</span>
                <span className="text-muted"> — {part ? t('coverage.awayPart', { part }) : t('coverage.away')}</span>
              </p>
              {theirs.map((c) => (
                <p key={c.id} className="text-[12.5px]">
                  <span className="inline-block w-24 tabular text-muted">{c.start_time.slice(0, 5)}–{c.end_time.slice(0, 5)}</span>
                  {c.coverer_name}
                </p>
              ))}
              {open.length > 0 && (
                <p className="flex items-center gap-1 text-[12.5px] font-medium text-late">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t('coverage.uncovered', { times: open.map((g) => `${g.start}–${g.end}`).join(', ') })}
                </p>
              )}
            </Link>
          );
        })}
      </Card>
    </section>
  );
}
