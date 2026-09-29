'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { OPEN_STAGES, type Prospect } from '@/types/sales';
import { NextPlanned, useProspectLabels } from './prospect-parts';
import { ProspectDialog, type ProspectChoices } from './prospect-dialog';

/** Open prospects by stage, soonest next step first; the closed ones after. */
export function ProspectList({
  prospects,
  choices,
  today,
}: {
  prospects: Prospect[];
  choices: ProspectChoices;
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const labels = useProspectLabels();
  const [creating, setCreating] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const closed = prospects.filter((p) => p.stage === 'won' || p.stage === 'lost');

  const row = (p: Prospect) => (
    <Link
      key={p.id}
      href={`/sales/prospects/${p.id}`}
      className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2/60"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">
          {p.company_name}
          {p.city && <span className="font-normal text-muted"> · {p.city}</span>}
        </span>
        {p.closed_at ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <Badge tone={p.stage === 'won' ? 'done' : 'neutral'}>{labels.stage(p.stage)}</Badge>
            {labels.entry(choices.lostReasons, p.lost_reason_id)}
            <span>{t('sales.closedOn', { date: formatDate(p.closed_at, 'medium') })}</span>
          </span>
        ) : (
          <NextPlanned next={p.next} kinds={choices.kinds} today={today} />
        )}
      </span>
      {p.owner_name && !p.closed_at && (
        <span className="hidden shrink-0 text-[12px] text-subtle sm:block">{p.owner_name}</span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
    </Link>
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('sales.newProspect')}
        </Button>
      </div>

      {prospects.length === 0 ? (
        <EmptyState title={t('sales.noProspects')} body={t('sales.noProspectsBody')} />
      ) : (
        <div className="space-y-4">
          {OPEN_STAGES.map((stage) => {
            const inStage = prospects.filter((p) => p.stage === stage);
            if (inStage.length === 0) return null;
            return (
              <section key={stage}>
                <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                  {labels.stage(stage)} <span className="tabular text-subtle">{inStage.length}</span>
                </h2>
                <Card className="divide-y divide-border">{inStage.map(row)}</Card>
              </section>
            );
          })}

          {closed.length > 0 && (
            <section>
              <button
                type="button"
                className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted hover:text-fg"
                onClick={() => setShowClosed((v) => !v)}
              >
                {t('sales.closedProspects')} <span className="tabular text-subtle">{closed.length}</span> {showClosed ? '▾' : '▸'}
              </button>
              {showClosed && <Card className="divide-y divide-border">{closed.map(row)}</Card>}
            </section>
          )}
        </div>
      )}

      {creating && <ProspectDialog prospect={null} choices={choices} today={today} onClose={() => setCreating(false)} />}
    </>
  );
}
