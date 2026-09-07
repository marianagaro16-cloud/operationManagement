'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CalendarOff } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Badge, Card, CardBody } from '@/components/ui/primitives';
import type { Task } from '@/types/database';

/**
 * Configuration health.
 *
 * A definition whose schedule cannot be resolved silently produces nothing —
 * the dangerous failure mode is that nobody notices. This surfaces those
 * definitions with a direct route to fixing them.
 *
 * Only DAILY tasks can appear here now. Every other frequency, and every
 * inventory, is placed by hand from the calendar rather than resolved from a
 * rule, so there is no configuration left for this panel to check on them.
 *
 * The third check is new and exists because pages no longer materialise work
 * as a side effect of rendering. With the cron the only generator, a cron that
 * has quietly stopped would show up as a dashboard that empties out over a few
 * days. Now it says so.
 */

export function ConfigHealth({
  unconfigured,
  stalled,
}: {
  unconfigured: Task[];
  stalled: boolean;
}) {
  const { t } = useI18n();
  const tasks = unconfigured.length;

  if (tasks === 0 && !stalled) {
    return (
      <Card>
        <CardBody className="flex items-center gap-2.5 pt-4">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-done" aria-hidden />
          <div>
            <p className="text-[13px] font-medium">{t('admin.configHealth')}</p>
            <p className="text-[12.5px] text-muted">{t('admin.configOk')}</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* The scheduler leads: an unconfigured definition produces nothing,
          but a stopped generator produces nothing for EVERYTHING. */}
      {stalled && (
        <Card className="border-late/30 bg-late/[0.05]">
          <CardBody className="flex items-start gap-2.5 pt-4">
            <CalendarOff className="mt-0.5 h-4 w-4 shrink-0 text-late" aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{t('admin.configStalled')}</p>
              <p className="mt-0.5 text-[12.5px] text-muted">{t('admin.configStalledBody')}</p>
              <Link
                href="/admin/settings"
                className="mt-1.5 inline-block text-[12.5px] font-medium text-late hover:underline"
              >
                {t('nav.settings')}
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      {tasks > 0 && (
        <UnconfiguredCard
          heading={t('admin.configTasksHeading')}
          summary={tasks === 1 ? t('admin.configWarningOne') : t('admin.configWarning', { count: tasks })}
          rows={unconfigured.map((task) => ({
            id: task.id,
            name: task.title,
            frequency: task.frequency,
            href: `/admin/tasks?edit=${task.id}`,
          }))}
          total={tasks}
          moreHref="/admin/tasks"
          actionLabel={t('admin.configureNow')}
        />
      )}

    </div>
  );
}

/** One warning block. Identical shape for both kinds, because they are one problem. */
function UnconfiguredCard({
  heading,
  summary,
  rows,
  total,
  moreHref,
  actionLabel,
}: {
  heading: string;
  summary: string;
  rows: { id: string; name: string; frequency: string; href: string }[];
  total: number;
  moreHref: string;
  actionLabel: string;
}) {
  const { t } = useI18n();

  return (
    <Card className="border-warn/30 bg-warn/[0.05]">
      <CardBody className="pt-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{heading}</p>
            <p className="text-[13px] font-semibold">{summary}</p>
            <ul className="mt-2 space-y-1">
              {rows.slice(0, 6).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{row.name}</span>
                  <Badge tone="warn">
                    {t(`frequency.${row.frequency}` as 'frequency.daily')}
                  </Badge>
                  <Link href={row.href} className="shrink-0 text-[12.5px] font-medium text-warn hover:underline">
                    {actionLabel}
                  </Link>
                </li>
              ))}
            </ul>
            {total > 6 && (
              <Link href={moreHref} className="mt-2 inline-block text-[12.5px] text-warn hover:underline">
                +{total - 6}
              </Link>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
