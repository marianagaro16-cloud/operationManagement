'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Boxes, Check, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge, Card, ErrorState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { localizedTitle, type TranslatableContent } from '@/lib/localized-content';
import { completeOccurrence } from '@/server/actions';
import type { CoverageEntry } from '@/types/absences';
import { usePermissionLabel } from './coverage-planner';

/**
 * "You are covering …": the viewer's coverage periods today. While one lasts,
 * the absent person's activities to do and inventories to count, and the
 * permissions that came with it. Nothing when the viewer covers nobody today.
 */
export function CoveringNowCard({
  periods,
  now,
  activities,
  inventories,
}: {
  periods: CoverageEntry[];
  /** "HH:MM" in Zurich, when the page was made. */
  now: string;
  activities: { id: string; assignee_id: string; due: string; title: string; translations: unknown }[];
  inventories: { id: string; assignee_ids: string[]; date: string; name: string }[];
}) {
  const { t, locale, formatDate } = useI18n();
  const router = useRouter();
  const permLabel = usePermissionLabel();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string[]>([]);
  if (periods.length === 0) return null;

  const isNow = (c: CoverageEntry) => c.start_time.slice(0, 5) <= now && now < c.end_time.slice(0, 5);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
          {t('coverage.youAreCovering')}
        </h2>
        <Link href="/absences?tab=coverage" className="text-[12.5px] font-medium text-accent hover:underline">
          {t('coverage.tabMine')}
        </Link>
      </div>
      <Card className="divide-y divide-border">
        {error && <div className="p-3"><ErrorState message={error} /></div>}
        {periods.map((c) => {
          const active = isNow(c);
          const theirActivities = activities.filter((a) => a.assignee_id === c.absent_profile_id && !done.includes(a.id));
          const theirInventories = inventories.filter((i) => i.assignee_ids.includes(c.absent_profile_id));
          return (
            <div key={c.id} className={cn('px-3.5 py-2.5', active && 'bg-accent/[0.04]')}>
              <p className="text-[13.5px]">
                <Link href={`/absences/${c.absence_id}`} className="font-semibold hover:text-accent">{c.absent_name}</Link>
                <span className="ml-2 tabular text-muted">{c.start_time.slice(0, 5)}–{c.end_time.slice(0, 5)}</span>
                <Badge tone={active ? 'done' : now < c.start_time.slice(0, 5) ? 'neutral' : 'skipped'} className="ml-2">
                  {active ? t('coverage.activeNow') : now < c.start_time.slice(0, 5) ? t('coverage.later') : t('coverage.ended')}
                </Badge>
              </p>
              {c.note && <p className="text-[12px] text-muted">{c.note}</p>}
              <Link href={`/absences/${c.absence_id}#handover`} className="text-[12.5px] font-medium text-accent hover:underline">
                {t('handover.see')}
              </Link>
              {c.permissions.length > 0 && (
                <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-muted">
                  {t('coverage.permissionsGiven')}
                  {c.permissions.map((p) => <Badge key={p} tone="accent">{permLabel(p)}</Badge>)}
                </p>
              )}
              {active ? (
                <>
                  {theirActivities.length === 0 && theirInventories.length === 0 && (
                    <p className="mt-1 text-[12.5px] text-muted">{t('coverage.nothingOfTheirs')}</p>
                  )}
                  {theirActivities.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {theirActivities.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 text-[13px]">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0 border border-border"
                            aria-label={t('coverage.markDone')}
                            disabled={pending}
                            onClick={() => {
                              setError(null);
                              startTransition(async () => {
                                const res = await completeOccurrence(a.id);
                                if (!res.ok) return setError(res.error);
                                setDone((d) => [...d, a.id]);
                                router.refresh();
                              });
                            }}
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                          <span className="min-w-0 flex-1">
                            {localizedTitle({ title: a.title, translations: a.translations } as TranslatableContent, locale)}
                          </span>
                          {a.due < formatIsoToday() && <span className="shrink-0 text-[11.5px] text-late">{formatDate(a.due, 'short')}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {theirInventories.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {theirInventories.map((i) => (
                        <li key={i.id}>
                          <Link href={`/inventory/${i.id}`} className="flex items-center gap-2 text-[13px] hover:text-accent">
                            <Boxes className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                            {i.name}
                            <span className="text-[11.5px] text-muted">{formatDate(i.date, 'short')}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1.5 text-[11.5px] text-muted">{t('coverage.recordedAsYou', { name: c.absent_name })}</p>
                </>
              ) : (
                now < c.start_time.slice(0, 5) && <p className="mt-1 text-[12px] text-muted">{t('coverage.workAppearsAt', { time: c.start_time.slice(0, 5) })}</p>
              )}
            </div>
          );
        })}
      </Card>
    </section>
  );
}

/** Today in Zurich, "YYYY-MM-DD" — what counts as overdue. */
function formatIsoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
}
