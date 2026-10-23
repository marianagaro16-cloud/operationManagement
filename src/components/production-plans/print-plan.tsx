'use client';

import { useEffect } from 'react';
import { useI18n } from '@/i18n';
import { NoteText } from '@/components/ui/note';
import { planLot, planTotals } from '@/domain/production-plan/plan';
import type { LineProduct, ProductionLine, ProductionPlan } from '@/server/production-plans';
import { PlanSheet } from './plan-sheet';
import { PlanFigures } from './plan-figures';

/**
 * The plan on a landscape page, as it went on the wall: only what has
 * quantities, the figures, the raw materials' lots, the notes. Opens the print
 * dialog once drawn; "Save as PDF" there gives the file.
 */
export function PrintPlan({ line, plan, products }: { line: ProductionLine; plan: ProductionPlan; products: LineProduct[] }) {
  const { t, formatDate } = useI18n();
  const totals = planTotals(products, plan.rows, line);
  const lot = planLot(plan.plan_date);

  useEffect(() => {
    // Bio_Plan de Producción_27.10.2026 — the name the files have always had.
    const [y, m, d] = plan.plan_date.split('-');
    document.title = `${line.name}_Plan de Producción_${d}.${m}.${y}${line.machine ? `_${line.machine}` : ''}`;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [line, plan.plan_date]);

  const css = [
    '@page { size: A4 landscape; margin: 8mm; }',
    'html, body { background: #fff !important; }',
    '.plan-print, .plan-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  ].join('\n');

  return (
    <main className="plan-print bg-white p-4 text-fg print:p-0">
      <style>{css}</style>
      <div className="mb-2 flex items-baseline justify-between gap-4 border-b border-border pb-1.5">
        <h1 className="text-[17px] font-semibold">
          {t('productionPlans.printTitle', { line: line.name })}{line.machine ? ` · ${line.machine}` : ''}
        </h1>
        <p className="text-[12px]">
          {formatDate(plan.plan_date, 'weekday')} · {t('productionPlans.lot')} <span className="font-semibold tabular-nums">{lot}</span>
        </p>
      </div>
      <div className="mb-3">
        <PlanFigures lot={lot} totals={totals} products={products} compact />
      </div>
      <PlanSheet planDate={plan.plan_date} products={products} rows={plan.rows} totals={totals} onlyFilled compact />
      <div className="mt-3 grid grid-cols-3 gap-4 text-[10.5px]">
        <div>
          <p className="mb-0.5 font-semibold">{t('productionPlans.materialLots')}</p>
          {plan.material_lots.some((m) => m.lot) ? plan.material_lots.filter((m) => m.lot).map((m, i) => <p key={i}>{m.material} · {m.lot}</p>) : <p>—</p>}
        </div>
        <div>
          <p className="mb-0.5 font-semibold">{t('productionPlans.notes')}</p>
          <NoteText text={plan.notes || '—'} />
        </div>
        <div>
          <p className="mb-0.5 font-semibold">{t('productionPlans.standingNotes')}</p>
          <NoteText text={line.standing_notes || '—'} />
        </div>
      </div>
    </main>
  );
}
