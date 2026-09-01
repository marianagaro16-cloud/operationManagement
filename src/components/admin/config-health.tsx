'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Badge, Card, CardBody } from '@/components/ui/primitives';
import type { Task } from '@/types/database';

/**
 * Configuration health.
 *
 * A task whose recurrence cannot be resolved silently produces nothing — the
 * dangerous failure mode is that nobody notices. This surfaces those tasks
 * prominently with a direct route to fixing them.
 */
export function ConfigHealth({ unconfigured }: { unconfigured: Task[] }) {
  const { t } = useI18n();
  const count = unconfigured.length;

  if (count === 0) {
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
    <Card className="border-warn/30 bg-warn/[0.05]">
      <CardBody className="pt-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">
              {count === 1
                ? t('admin.configWarningOne')
                : t('admin.configWarning', { count })}
            </p>
            <ul className="mt-2 space-y-1">
              {unconfigured.slice(0, 6).map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{task.title}</span>
                  <Badge tone="warn">
                    {t(`frequency.${task.frequency}` as 'frequency.daily')}
                  </Badge>
                  <Link
                    href={`/admin/tasks?edit=${task.id}`}
                    className="shrink-0 text-[12.5px] font-medium text-warn hover:underline"
                  >
                    {t('admin.configureNow')}
                  </Link>
                </li>
              ))}
            </ul>
            {count > 6 && (
              <Link href="/admin/tasks" className="mt-2 inline-block text-[12.5px] text-warn hover:underline">
                +{count - 6}
              </Link>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
