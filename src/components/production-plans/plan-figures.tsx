'use client';

import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { PlanTotals } from '@/domain/production-plan/plan';
import type { LineProduct } from '@/server/production-plans';
import { kgText } from './plan-sheet';

/** What the plan adds up to: the figures the Excel works out beside the sheet. */
export function PlanFigures({
  lot,
  totals,
  products,
  compact = false,
}: {
  lot: string;
  totals: PlanTotals;
  products: LineProduct[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const figures: [string, string][] = [
    [t('productionPlans.lot'), lot],
    [t('productionPlans.tortillaKg'), `${kgText(totals.kg.tortilla)} kg`],
    ...(totals.kg.masa ? [[t('productionPlans.masaKg'), `${kgText(totals.kg.masa)} kg`] as [string, string]] : []),
    [t('productionPlans.masaPura'), `${kgText(totals.masaPura)} kg`],
    ...(totals.mixed
      ? ([
          [t('productionPlans.mixedMasa'), `${kgText(totals.mixed.masa)} kg`],
          [t('productionPlans.flour'), `${kgText(totals.mixed.flour)} kg`],
          [t('productionPlans.water'), `${kgText(totals.mixed.water)} L`],
          [t('productionPlans.salt'), `${kgText(totals.mixed.salt)} kg`],
        ] as [string, string][])
      : []),
    [t('productionPlans.grainKg'), `${kgText(totals.grainKg)} kg`],
    [t('productionPlans.sacks'), String(totals.sacks)],
    ...(totals.kg.totopo || totals.kg.tostada
      ? ([
          [t('productionPlans.totopoKg'), `${kgText(totals.kg.totopo + totals.kg.tostada)} kg`],
          [t('productionPlans.tortillasForTotopos'), `${kgText(totals.tortillasForTotopos)} kg`],
        ] as [string, string][])
      : []),
  ];
  const missing = products.filter((p) => totals.missingWeight.includes(p.product_id));
  return (
    <div>
      <dl className={cn('grid gap-x-4 gap-y-1.5', compact ? 'grid-cols-4 text-[10.5px]' : 'grid-cols-2 text-[13px] sm:grid-cols-3')}>
        {figures.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 border-b border-border/60 py-0.5">
            <dt className="text-muted">{label}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {missing.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warn">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('productionPlans.missingWeight', { products: missing.map((p) => p.code ?? p.name).join(', ') })}
        </p>
      )}
    </div>
  );
}
