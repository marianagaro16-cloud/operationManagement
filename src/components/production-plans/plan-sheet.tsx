'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { bestBefore, groupProducts, type PlanTotals } from '@/domain/production-plan/plan';
import type { LineProduct, PlanRow } from '@/server/production-plans';

/**
 * The plan as the sheet has it: one table per section (tortillas, masa,
 * totopos, tostadas) — customers down, the line's products across under their
 * heading, the reserve and the totals at the bottom.
 *
 * Planners type into the cells; everyone else reads. `onlyFilled` leaves out
 * products and rows with nothing, which is how the floor and the print want it.
 */
export function PlanSheet({
  planDate,
  products,
  rows,
  totals,
  onlyFilled,
  editable = false,
  compact = false,
  onCell,
  onEditRow,
  onDeleteRow,
}: {
  planDate: string;
  products: LineProduct[];
  rows: PlanRow[];
  totals: PlanTotals;
  onlyFilled: boolean;
  editable?: boolean;
  /** The print: smaller type, no controls. */
  compact?: boolean;
  onCell?: (row: PlanRow, productId: string, value: number | null) => void;
  onEditRow?: (row: PlanRow) => void;
  onDeleteRow?: (row: PlanRow) => void;
}) {
  const { t, formatDate } = useI18n();
  const sections = groupProducts(products)
    .map((s) => ({
      ...s,
      groups: s.groups
        .map((g) => ({ ...g, products: onlyFilled ? g.products.filter((p) => (totals.units[p.product_id] ?? 0) > 0) : g.products }))
        .filter((g) => g.products.length > 0),
    }))
    .filter((s) => s.groups.length > 0);

  if (sections.length === 0) {
    return <p className="text-[13px] text-muted">{t('productionPlans.nothingPlanned')}</p>;
  }

  const rowLabel = (row: PlanRow) => (row.is_reserve ? t('productionPlans.reserve') : row.customer_name ?? row.label ?? '—');
  const cellText = compact ? 'text-[10px]' : 'text-[12px]';

  return (
    <div className={cn('space-y-5', compact && 'space-y-3')}>
      {sections.map((section) => {
        const ids = section.groups.flatMap((g) => g.products.map((p) => p.product_id));
        const sectionRows = rows.filter((r) => r.is_reserve || !onlyFilled || ids.some((id) => (r.quantities[id] ?? 0) > 0));
        const kg = (pid: string) => {
          const p = products.find((x) => x.product_id === pid);
          return p?.weight_kg != null ? (totals.units[pid] ?? 0) * p.weight_kg : null;
        };
        return (
          <section key={section.section}>
            <h3 className={cn('mb-1.5 font-semibold', compact ? 'text-[12px]' : 'text-[14px]')}>
              {t(`productionPlans.section.${section.section}` as MessageKey)}
            </h3>
            <div className={cn(!compact && 'overflow-x-auto rounded-lg border border-border')}>
              <table className={cn('border-collapse', cellText, compact ? 'w-full' : 'min-w-full')}>
                <thead>
                  <tr className="bg-surface-2">
                    <th rowSpan={2} className={cn('sticky left-0 z-10 border-b border-r border-border bg-surface-2 px-2 py-1 text-left font-medium', compact ? 'w-[120px]' : 'min-w-[170px]')}>
                      {t('productionPlans.customer')}
                    </th>
                    {section.groups.map((g) => (
                      <th key={g.label} colSpan={g.products.length} className="border-b border-r border-border px-2 py-1 text-center font-semibold">
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-surface-2/60">
                    {section.groups.flatMap((g) =>
                      g.products.map((p) => (
                        <th key={p.product_id} className={cn('border-b border-r border-border px-1.5 py-1 align-top font-normal', compact ? 'w-[64px]' : 'min-w-[84px] max-w-[110px]')}>
                          <span className="block font-medium tabular-nums">{p.code ?? '—'}</span>
                          <span className="block leading-tight text-muted" title={p.name}>{shortName(p.name)}</span>
                          {p.best_before_days != null && (
                            <span className="mt-0.5 block text-[10px] text-subtle">
                              {t('productionPlans.bestBeforeShort')} {formatDate(bestBefore(planDate, p.best_before_days)!, 'shortYear')}
                            </span>
                          )}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sectionRows.map((row) => (
                    <tr key={row.id} className={cn(row.is_reserve && 'bg-warn/[0.06]')}>
                      <td className="sticky left-0 z-10 border-b border-r border-border bg-surface px-2 py-1">
                        <div className="flex items-start gap-1">
                          <div className="min-w-0 flex-1">
                            <p className={cn('truncate font-medium', row.is_reserve && 'uppercase')}>{rowLabel(row)}</p>
                            {(row.delivery_date || row.delivery_note) && (
                              <p className="truncate text-[10.5px] text-muted">
                                {[row.delivery_date ? formatDate(row.delivery_date, 'short') : null, row.delivery_note].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                          {editable && !row.is_reserve && !compact && (
                            <span className="flex shrink-0">
                              <button type="button" className="rounded p-0.5 text-subtle hover:text-fg" aria-label={t('common.edit')} onClick={() => onEditRow?.(row)}>
                                <Pencil className="h-3 w-3" aria-hidden />
                              </button>
                              <button type="button" className="rounded p-0.5 text-subtle hover:text-late" aria-label={t('common.delete')} onClick={() => onDeleteRow?.(row)}>
                                <Trash2 className="h-3 w-3" aria-hidden />
                              </button>
                            </span>
                          )}
                        </div>
                      </td>
                      {section.groups.flatMap((g) =>
                        g.products.map((p) => (
                          <td key={p.product_id} className="border-b border-r border-border px-1 py-0.5 text-center tabular-nums">
                            {editable && !compact ? (
                              <QuantityCell value={row.quantities[p.product_id] ?? null} onSave={(v) => onCell?.(row, p.product_id, v)} />
                            ) : (
                              row.quantities[p.product_id] || ''
                            )}
                          </td>
                        )),
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-2 font-semibold">
                    <td className="sticky left-0 z-10 border-r border-border bg-surface-2 px-2 py-1">{t('productionPlans.totalUnits')}</td>
                    {section.groups.flatMap((g) =>
                      g.products.map((p) => (
                        <td key={p.product_id} className="border-r border-border px-1 py-1 text-center tabular-nums">{totals.units[p.product_id] || ''}</td>
                      )),
                    )}
                  </tr>
                  <tr className="bg-surface-2/60 text-muted">
                    <td className="sticky left-0 z-10 border-r border-border bg-surface-2 px-2 py-1">{t('productionPlans.totalKg')}</td>
                    {section.groups.map((g) => {
                      const sum = g.products.reduce((s, p) => s + (kg(p.product_id) ?? 0), 0);
                      return (
                        <td key={g.label} colSpan={g.products.length} className="border-r border-border px-1 py-1 text-center tabular-nums">
                          {sum ? `${kgText(sum)} kg` : ''}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The cell: typed, saved when left. */
function QuantityCell({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [seen, setSeen] = useState(value);
  // Follow the server after a refresh, unless this cell is being typed in.
  if (value !== seen) {
    setSeen(value);
    setText(value == null ? '' : String(value));
  }
  return (
    <input
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value.replace(',', '.'))}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        const v = text.trim() === '' ? null : Number(text);
        if (v != null && (!Number.isFinite(v) || v < 0)) return setText(value == null ? '' : String(value));
        if ((v || null) !== (value || null)) onSave(v || null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="h-7 w-full min-w-[3.5rem] rounded border border-transparent bg-transparent px-1 text-center tabular-nums outline-none hover:border-border focus:border-accent focus:bg-surface"
    />
  );
}

export function kgText(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(kg < 10 ? 2 : 1);
}

/** "Bio Mais Tortillas 0.5 kg - Ø14cm" → "0.5 kg - Ø14cm": the heading already says what it is. */
function shortName(name: string): string {
  const cut = name.replace(/^(Bio\s+)?(Blaue\s+|Gelbe\s+)?(Mais\s*)?(Tortillas?|Masa|Totopos|Tostadas|Taco Shell|Huaraches?)\s*/i, '');
  return cut.length >= 3 ? cut : name;
}
