'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, KeyRound, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, Checkbox, EmptyState, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { WorkerDialog, type HrAccount } from './worker-dialog';
import { HrExport } from './hr-export';
import type { Team } from '@/lib/authz';
import type { HrWorker } from '@/types/hr';
import { teamLabelKey } from '@/lib/authz';

/** Everyone with a file, the people who still work here first. */
export function WorkerList({
  workers,
  followUps,
  keys,
  onlyFollowUps = false,
  accounts,
  teams,
}: {
  workers: HrWorker[];
  /** Workers with a note whose follow-up is still open, or already late. */
  followUps: Record<string, 'open' | 'overdue'>;
  /** The numbers of the keys each worker holds now. */
  keys: Record<string, string[]>;
  /** Start on those only: where Inicio's line leads. */
  onlyFollowUps?: boolean;
  accounts: HrAccount[];
  teams: Team[];
}) {
  const { t, formatDate } = useI18n();
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(onlyFollowUps);
  const [query, setQuery] = useState('');

  const teamLabel = (team: Team) => (t(teamLabelKey(team)));
  const linked = new Set(workers.map((w) => w.profile_id).filter(Boolean));
  const openCount = workers.filter((w) => followUps[w.id]).length;
  // Someone who left can still have a follow-up open.
  const q = query.trim().toLowerCase();
  // By name, or by the number of a key they hold.
  const matches = (w: HrWorker) => !q || w.name.toLowerCase().includes(q) || (keys[w.id] ?? []).some((n) => n.toLowerCase() === q);
  const shown = workers.filter((w) => matches(w) && (onlyOpen && openCount > 0 ? followUps[w.id] : showInactive || w.is_active));
  const inactiveCount = workers.filter((w) => !w.is_active).length;

  return (
    <>
      <PageHeader
        title={t('hr.navLabel')}
        subtitle={t('hr.subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/hr/keys"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              {t('hrKey.title')}
            </Link>
            <HrExport />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('hr.newWorker')}
            </Button>
          </div>
        }
      />

      <Input
        aria-label={t('hrKey.listSearch')}
        placeholder={t('hrKey.listSearch')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-3 h-8 w-full text-[13px] sm:w-72"
      />

      {inactiveCount > 0 && (
        <Checkbox
          className="mb-3"
          label={t('hr.showInactive')}
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
      )}

      {openCount > 0 && (
        <Checkbox
          className="mb-3"
          label={t('hrNote.onlyOpen', { count: openCount })}
          checked={onlyOpen}
          onChange={(e) => setOnlyOpen(e.target.checked)}
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
                  {keys[w.id] && (
                    <Badge tone="neutral">
                      <KeyRound className="mr-1 inline h-3 w-3" aria-hidden />
                      {keys[w.id]!.join(', ')}
                    </Badge>
                  )}
                  {followUps[w.id] && (
                    <Badge tone={followUps[w.id] === 'overdue' ? 'late' : 'accent'}>
                      {t(followUps[w.id] === 'overdue' ? 'hrNote.listOverdue' : 'hrNote.listOpen')}
                    </Badge>
                  )}
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
