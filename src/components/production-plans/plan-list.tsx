'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, ClipboardList, Plus, Settings } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shell/app-shell';
import { Badge, Card, EmptyState, Field, Input, Select } from '@/components/ui/primitives';
import { createProductionPlan } from '@/server/production-plan-actions';
import type { ProductionLine, ProductionPlanSummary } from '@/server/production-plans';
import { usePlanError } from './plan-view';

/** The plans, upcoming first then past, and — for planners — a new one. */
export function PlanList({
  lines,
  plans,
  today,
  canPlan,
}: {
  lines: ProductionLine[];
  plans: ProductionPlanSummary[];
  today: string;
  canPlan: boolean;
}) {
  const { t, formatDate } = useI18n();
  const [creating, setCreating] = useState(false);
  const lineName = (id: string) => {
    const l = lines.find((x) => x.id === id);
    return l ? `${l.name}${l.machine ? ` · ${l.machine}` : ''}` : '—';
  };
  const upcoming = plans.filter((p) => p.plan_date >= today).sort((a, b) => a.plan_date.localeCompare(b.plan_date));
  const past = plans.filter((p) => p.plan_date < today);

  const list = (items: ProductionPlanSummary[]) => (
    <ul className="space-y-1.5">
      {items.map((p) => (
        <li key={p.id}>
          <Link href={`/production-plans/${p.id}`}>
            <Card className={cn('flex items-center justify-between gap-3 p-3 hover:border-accent/50', p.plan_date === today && 'border-accent/50')}>
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium">
                  {formatDate(p.plan_date, 'weekday')}
                  {p.plan_date === today && <Badge tone="accent" className="ml-2">{t('productionPlans.today')}</Badge>}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted">
                  {lineName(p.line_id)} · {t('productionPlans.rowCount', { count: Math.max(0, p.row_count - 1) })}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader
        title={t('productionPlans.title')}
        subtitle={t(canPlan ? 'productionPlans.subtitle' : 'productionPlans.subtitleRead')}
        action={
          canPlan ? (
            <div className="flex items-center gap-2">
              <Link href="/production-plans/settings">
                <Button size="sm" variant="ghost" aria-label={t('productionPlans.settings')}>
                  <Settings className="h-4 w-4" aria-hidden />
                </Button>
              </Link>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                {t('productionPlans.newPlan')}
              </Button>
            </div>
          ) : undefined
        }
      />

      {plans.length === 0 ? (
        <EmptyState title={t(canPlan ? 'productionPlans.empty' : 'productionPlans.emptyToday')} icon={<ClipboardList className="h-5 w-5" aria-hidden />} />
      ) : (
        <div className="space-y-5">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{t('productionPlans.upcoming')}</h2>
              {list(upcoming)}
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{t('productionPlans.past')}</h2>
              {list(past)}
            </section>
          )}
        </div>
      )}

      {creating && <NewPlanDialog lines={lines.filter((l) => l.is_active)} today={today} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewPlanDialog({ lines, today, onClose }: { lines: ProductionLine[]; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = usePlanError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lineId, setLineId] = useState(lines[0]?.id ?? '');
  const [date, setDate] = useState(today);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('productionPlans.newPlan')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!lineId || !date}
            onClick={() =>
              startTransition(async () => {
                const res = await createProductionPlan({ line_id: lineId, plan_date: date });
                if (!res.ok) return setError(translateError(res.error));
                router.push(`/production-plans/${res.data.id}`);
              })
            }
          >
            {t('productionPlans.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('productionPlans.line')}>
          <Select value={lineId} onChange={(e) => setLineId(e.target.value)}>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>{l.name}{l.machine ? ` · ${l.machine}` : ''}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('productionPlans.date')} hint={t('productionPlans.createHint')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
