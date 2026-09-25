'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, Checkbox, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { WorkerDialog, type HrAccount } from './worker-dialog';
import type { Team } from '@/lib/authz';
import type { HrWorker } from '@/types/hr';

/** Everyone with a file, the people who still work here first. */
export function WorkerList({
  workers,
  accounts,
  teams,
}: {
  workers: HrWorker[];
  accounts: HrAccount[];
  teams: Team[];
}) {
  const { t, formatDate } = useI18n();
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const teamLabel = (team: Team) => (team === 'production' ? t('roles.teamProduction') : t('roles.teamOperations'));
  const linked = new Set(workers.map((w) => w.profile_id).filter(Boolean));
  const shown = workers.filter((w) => showInactive || w.is_active);
  const inactiveCount = workers.filter((w) => !w.is_active).length;

  return (
    <>
      <PageHeader
        title={t('hr.navLabel')}
        subtitle={t('hr.subtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('hr.newWorker')}
          </Button>
        }
      />

      {inactiveCount > 0 && (
        <Checkbox
          className="mb-3"
          label={t('hr.showInactive')}
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
      )}

      {shown.length === 0 ? (
        <EmptyState title={t('hr.noWorkers')} body={t('hr.noWorkersBody')} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {shown.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/hr/${w.id}`}
                  className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className={cn('break-words text-[13.5px] font-medium', !w.is_active && 'text-muted')}>{w.name}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11.5px] text-muted">
                      <span>{teamLabel(w.team)}</span>
                      {w.position && <span>· {w.position}</span>}
                      {w.start_date && <span>· {t('hr.since', { date: formatDate(w.start_date, 'medium') })}</span>}
                    </p>
                  </div>
                  {!w.is_active && <Badge tone="neutral">{t('hr.inactive')}</Badge>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {creating && (
        <WorkerDialog
          worker={null}
          accounts={accounts.filter((a) => !linked.has(a.id))}
          teams={teams}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
