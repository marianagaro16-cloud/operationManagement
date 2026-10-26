'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/i18n';
import { NoteText } from '@/components/ui/note';
import { planLot, planTotals } from '@/domain/production-plan/plan';
import type { LineProduct, ProductionLine, ProductionPlan } from '@/server/production-plans';
import { PlanSheet } from './plan-sheet';
import { PlanFigures } from './plan-figures';

/**
 * The plan on a landscape page, as it went on the wall: only what has
 * quantities, the figures, the raw materials' lots, the notes. Always one
 * sheet: laid out at the page's width, then shrunk until it fits its height.
 * Opens the print dialog once drawn; "Save as PDF" there gives the file.
 */
export function PrintPlan({ line, plan, products }: { line: ProductionLine; plan: ProductionPlan; products: LineProduct[] }) {
  const { t, formatDate } = useI18n();
  const totals = planTotals(products, plan.rows, line);
  const lot = planLot(plan.plan_date);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Bio_Plan de Producción_27.10.2026 — the name the files have always had.
    const [y, m, d] = plan.plan_date.split('-');
    document.title = `${line.name}_Plan de Producción_${d}.${m}.${y}${line.machine ? `_${line.machine}` : ''}`;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    document.fonts.ready.then(() => {
      const el = sheet.current;
      if (cancelled || !el) return;
      el.style.zoom = '1';
      const scale = Math.min(1, PAGE_PX.height / el.scrollHeight, PAGE_PX.width / el.scrollWidth);
      el.style.zoom = String(Math.floor(scale * 1000) / 1000);
      timer = setTimeout(() => window.print(), 400);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [line, plan.plan_date]);

  const css = [
    '@page { size: A4 landscape; margin: 8mm; }',
    'html, body { background: #fff !important; }',
    '.plan-print, .plan-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  ].join('\n');

  return (
    <main className="plan-print bg-white p-4 text-fg print:p-0">
      <style>{css}</style>
      <div ref={sheet} style={{ width: PAGE_PX.width }}>
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
      </div>
    </main>
  );
}

/** A4 landscape less the 8 mm margins, in CSS pixels (96 per inch), with a little room to spare. */
const PAGE_PX = { width: Math.floor((281 / 25.4) * 96), height: Math.floor((194 / 25.4) * 96) - 12 };
