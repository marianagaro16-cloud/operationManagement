'use client';

import { useEffect, useRef } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { NoteText } from '@/components/ui/note';
import { bestBefore, groupProducts, planLot, planTotals, type PlanTotals } from '@/domain/production-plan/plan';
import type { LineProduct, ProductionLine, ProductionPlan } from '@/server/production-plans';
import { kgText, PlanSheet } from './plan-sheet';
import { PlanFigures } from './plan-figures';

/**
 * The plan on a landscape page, as it goes on the wall. First, in large type,
 * what to make: one line per product with its units, kg, best-before and a box
 * to tick; then the figures, the raw materials' lots and the notes. Last, the
 * customer grid, which alone shrinks to fill what is left of the one sheet —
 * the whole page shrinks only when the grid would become unreadable.
 * Opens the print dialog once drawn; "Save as PDF" there gives the file.
 */
export function PrintPlan({ line, plan, products }: { line: ProductionLine; plan: ProductionPlan; products: LineProduct[] }) {
  const { t, formatDate } = useI18n();
  const totals = planTotals(products, plan.rows, line);
  const lot = planLot(plan.plan_date);
  const sheet = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Bio_Plan de Producción_27.10.2026 — the name the files have always had.
    const [y, m, d] = plan.plan_date.split('-');
    document.title = `${line.name}_Plan de Producción_${d}.${m}.${y}${line.machine ? `_${line.machine}` : ''}`;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    document.fonts.ready.then(() => {
      const el = sheet.current;
      const g = grid.current;
      if (cancelled || !el || !g) return;
      el.style.zoom = '1';
      g.style.zoom = '1';
      const gridHeight = g.offsetHeight;
      const top = el.scrollHeight - gridHeight;
      let gridScale = Math.min(1, (PAGE_PX.height - top) / gridHeight, PAGE_PX.width / g.scrollWidth);
      let pageScale = 1;
      if (gridScale < MIN_GRID_SCALE) {
        gridScale = Math.min(MIN_GRID_SCALE, PAGE_PX.width / g.scrollWidth);
        pageScale = Math.min(1, PAGE_PX.height / (top + gridHeight * gridScale));
      }
      g.style.zoom = String(Math.floor(gridScale * 1000) / 1000);
      el.style.zoom = String(Math.floor(pageScale * 1000) / 1000);
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
        <div className="mb-3 flex items-baseline justify-between gap-4 border-b-2 border-fg pb-1.5">
          <h1 className="text-[22px] font-bold">
            {t('productionPlans.printTitle', { line: line.name })}{line.machine ? ` · ${line.machine}` : ''}
          </h1>
          <p className="text-[16px]">
            {formatDate(plan.plan_date, 'weekday')} · {t('productionPlans.lot')} <span className="font-bold tabular-nums">{lot}</span>
          </p>
        </div>
        <WhatToMake planDate={plan.plan_date} products={products} totals={totals} />
        <div className="mb-3">
          <PlanFigures lot={lot} totals={totals} products={products} />
        </div>
        <div className="mb-3 grid grid-cols-3 gap-4 text-[12px]">
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
        <div ref={grid}>
          <h2 className="mb-1 border-t border-border pt-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{t('productionPlans.customerDetail')}</h2>
          <PlanSheet planDate={plan.plan_date} products={products} rows={plan.rows} totals={totals} onlyFilled compact />
        </div>
      </div>
    </main>
  );
}

/** The products with units, by section: the list the floor works down. */
function WhatToMake({ planDate, products, totals }: { planDate: string; products: LineProduct[]; totals: PlanTotals }) {
  const { t, formatDate } = useI18n();
  const sections = groupProducts(products.filter((p) => (totals.units[p.product_id] ?? 0) > 0));
  if (sections.length === 0) return <p className="mb-3 text-[15px]">{t('productionPlans.nothingPlanned')}</p>;
  const head = 'border-b-2 border-fg px-2 py-1 text-left text-[12px] font-semibold uppercase tracking-wide';
  return (
    <section className="mb-4">
      <h2 className="mb-1 text-[16px] font-bold uppercase tracking-wide">{t('productionPlans.whatToMake')}</h2>
      <table className="w-full border-collapse text-[15px]">
        <thead>
          <tr>
            <th className={`${head} w-[56px] text-center`}>{t('productionPlans.done')}</th>
            <th className={head}>{t('productionPlans.product')}</th>
            <th className={`${head} w-[110px] text-right`}>{t('productionPlans.units')}</th>
            <th className={`${head} w-[100px] text-right`}>{t('productionPlans.kg')}</th>
            <th className={`${head} w-[170px] text-right`}>{t('productionPlans.bestBefore')}</th>
          </tr>
        </thead>
        {sections.map((s) => (
          <tbody key={s.section}>
            <tr>
              <td colSpan={5} className="bg-surface-2 px-2 pb-0.5 pt-1.5 text-[13px] font-semibold">
                {t(`productionPlans.section.${s.section}` as MessageKey)}
              </td>
            </tr>
            {s.groups.flatMap((g) =>
              g.products.map((p) => {
                const units = totals.units[p.product_id] ?? 0;
                const bb = bestBefore(planDate, p.best_before_days);
                return (
                  <tr key={p.product_id} className="border-b border-border">
                    <td className="px-2 py-1.5 text-center">
                      <span className="inline-block h-5 w-5 rounded-sm border-2 border-fg align-middle" />
                    </td>
                    <td className="px-2 py-1.5">
                      {p.code && <span className="mr-2 font-semibold tabular-nums">{p.code}</span>}
                      {p.name}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[18px] font-bold tabular-nums">{units}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{p.weight_kg != null ? kgText(units * p.weight_kg) : '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{bb ? formatDate(bb, 'shortYear') : '—'}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        ))}
      </table>
    </section>
  );
}

/** A4 landscape less the 8 mm margins, in CSS pixels (96 per inch), with a little room to spare. */
const PAGE_PX = { width: Math.floor((281 / 25.4) * 96), height: Math.floor((194 / 25.4) * 96) - 12 };
/** Below this the customer grid is too small to read; the whole page shrinks instead. */
const MIN_GRID_SCALE = 0.6;
