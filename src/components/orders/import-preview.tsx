'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, HelpCircle, Trash2 } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Badge, Input } from '@/components/ui/primitives';
import {
  isImportable,
  lineState,
  summarize,
  withProduct,
  withQuantity,
  type LineState,
  type PipelineProduct,
  type PreviewLine,
} from '@/domain/orders/import/pipeline';
import type { MatchReason } from '@/domain/orders/import/matching';
import type { QuantityIssue } from '@/domain/orders/import/packaging';
import { productLabel, type Product } from '@/types/orders';

/**
 * The review screen every import passes through.
 *
 * ONE component for both methods. An Excel row and an emailed sentence differ
 * only in where the text came from, so they are reviewed on the same screen
 * with the same three states and the same corrections — which is what stops
 * the two paths from drifting into two different sets of safeguards.
 *
 * Nothing here creates anything. Confirming hands the accepted lines back to
 * the order form, where the user still sees the whole order and still presses
 * Save. The import is an assistant to the existing workflow, not a second one.
 */

const STATE_TONE: Record<LineState, 'done' | 'warn' | 'late'> = {
  ready: 'done',
  review: 'warn',
  unknown: 'late',
};

const STATE_LABEL: Record<LineState, MessageKey> = {
  ready: 'import.stateMatched',
  review: 'import.stateReview',
  unknown: 'import.stateUnknown',
};

const REASON_LABEL: Record<MatchReason, MessageKey> = {
  code: 'import.reasonCode',
  name: 'import.reasonName',
  alias: 'import.reasonAlias',
  normalized_name: 'import.reasonNormalizedName',
  partial: 'import.reasonPartial',
  partial_size: 'import.reasonPartialSize',
};

const ISSUE_LABEL: Record<QuantityIssue, MessageKey> = {
  no_conversion: 'import.issueNoConversion',
  weight_unit: 'import.issueWeightUnit',
  no_product: 'import.issueNoProduct',
  not_positive: 'import.issueNotPositive',
  not_a_number: 'import.issueNotANumber',
};

export function ImportPreview({
  lines,
  onLinesChange,
  products,
  templateName,
  onConfirm,
  onCancel,
}: {
  lines: PreviewLine[];
  onLinesChange: (lines: PreviewLine[]) => void;
  /** The active catalogue, for correcting a product by hand. */
  products: Product[];
  /** Named when the source was a file, so the user knows how it was read. */
  templateName: string | null;
  onConfirm: (accepted: PreviewLine[]) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  // The pipeline works on its own product shape; the dialog holds the app's.
  // Converted once here rather than at every edit.
  const pipelineProducts = useMemo<PipelineProduct[]>(
    () =>
      products.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        family: p.family,
        presentation: p.presentation,
        is_active: p.is_active,
        units_per_box: toNumberOrNull(p.units_per_box),
      })),
    [products],
  );

  const kept = lines.filter((l) => !dropped.has(l.key));
  const summary = summarize(kept);
  const accepted = kept.filter(isImportable);

  const update = (key: string, next: PreviewLine) =>
    onLinesChange(lines.map((l) => (l.key === key ? next : l)));

  return (
    <div className="space-y-3">
      {/* What was read, and how. A file read through the wrong template is
          the failure this line exists to make visible. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2">
        <span className="text-[12.5px] text-muted">
          {templateName
            ? t('import.readWithTemplate', { name: templateName })
            : t('import.readFromText')}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{t('import.countLines', { count: summary.total })}</Badge>
          {summary.ready > 0 && <Badge tone="done">{t('import.countMatched', { count: summary.ready })}</Badge>}
          {summary.review > 0 && <Badge tone="warn">{t('import.countReview', { count: summary.review })}</Badge>}
          {summary.unknown > 0 && <Badge tone="late">{t('import.countUnknown', { count: summary.unknown })}</Badge>}
        </span>
      </div>

      {kept.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted">
          {t('import.nothingLeft')}
        </p>
      ) : (
        <ul className="space-y-2">
          {kept.map((line) => {
            const state = lineState(line);
            return (
              <li
                key={line.key}
                className={cn(
                  'rounded-lg border px-3 py-2.5',
                  state === 'ready' && 'border-border bg-surface',
                  state === 'review' && 'border-warn/30 bg-warn/[0.04]',
                  state === 'unknown' && 'border-late/30 bg-late/[0.04]',
                )}
              >
                {/* What the customer wrote, always visible. The user is
                    checking the machine's reading against it. */}
                <div className="mb-2 flex items-start gap-2">
                  <StateIcon state={state} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium" title={line.sourceText}>
                      {line.sourceText || t('import.blankSource')}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {line.rowNumber ? `${t('import.row', { row: line.rowNumber })} · ` : ''}
                      {t('import.asWritten', {
                        qty: formatQuantity(line.rawQuantity),
                        unit: t(unitLabel(line.unit)),
                      })}
                      {line.matchReason ? ` · ${t(REASON_LABEL[line.matchReason])}` : ''}
                    </p>
                  </div>
                  <Badge tone={STATE_TONE[state]}>{t(STATE_LABEL[state])}</Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('import.dropLine')}
                    onClick={() => setDropped(new Set(dropped).add(line.key))}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>

                {/* Stacks on a phone, side by side on a tablet upward. Every
                    correction is reachable by touch. */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <Combobox
                    className="min-w-0 flex-1"
                    items={products.filter((p) => p.is_active)}
                    value={line.productId}
                    onChange={(id) => update(line.key, withProduct(line, id, pipelineProducts))}
                    getKey={(p) => p.id}
                    getLabel={(p) => (p.code ? `${p.code} · ${productLabel(p)}` : productLabel(p))}
                    getSearchText={(p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family}`}
                    placeholder={t('import.selectProduct')}
                    emptyMessage={t('orders.noProductsFound')}
                    renderOption={(p) => (
                      <span className="flex items-baseline gap-2">
                        <span className="w-12 shrink-0 tabular text-[11.5px] text-subtle">{p.code ?? '—'}</span>
                        <span className="min-w-0 flex-1 truncate">{productLabel(p)}</span>
                      </span>
                    )}
                  />

                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      value={line.quantity === null ? '' : String(line.quantity)}
                      onChange={(e) => update(line.key, withQuantity(line, Number(e.target.value)))}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      className="w-24"
                      aria-label={t('import.quantityInUnits')}
                      placeholder={t('import.units')}
                    />
                    <span className="text-[11.5px] text-muted">{t('import.units')}</span>
                  </div>
                </div>

                {/* The conversion, shown rather than assumed. */}
                {line.unitsPerBox !== null && line.quantity !== null && (
                  <p className="mt-1.5 text-[11.5px] text-muted">
                    {t('import.conversionApplied', {
                      boxes: formatQuantity(line.rawQuantity),
                      perBox: formatQuantity(line.unitsPerBox),
                      units: formatQuantity(line.quantity),
                    })}
                  </p>
                )}

                {line.quantityIssue && (
                  <p className="mt-1.5 text-[12px] text-warn">{t(ISSUE_LABEL[line.quantityIssue])}</p>
                )}

                {/* Ambiguity offers the alternatives instead of a dead end. */}
                {line.matchStatus === 'ambiguous' && !line.productId && line.candidates.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11.5px] text-muted">{t('import.possibleMatches')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {line.candidates.map((c) => {
                        const p = products.find((x) => x.id === c.productId);
                        if (!p) return null;
                        return (
                          <button
                            key={c.productId}
                            type="button"
                            onClick={() => update(line.key, withProduct(line, c.productId, pipelineProducts))}
                            className={
                              'rounded-md border border-border bg-surface px-2 py-1 text-[12px] ' +
                              'text-muted transition-colors hover:border-accent hover:text-fg touch-target'
                            }
                          >
                            {productLabel(p)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {line.matchStatus === 'unknown' && !line.productId && (
                  <p className="mt-1.5 text-[12px] text-late">{t('import.couldNotIdentifyProduct')}</p>
                )}

                {line.note && (
                  <p className="mt-1.5 truncate text-[11.5px] text-muted" title={line.note}>
                    {t('import.customerNote')}: {line.note}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Says exactly what pressing the button will do, including what it
          will NOT do — an unresolved line is left behind, not smuggled in. */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <p className="mr-auto text-[12.5px] text-muted">
          {t('import.willAdd', { count: accepted.length })}
          {summary.total - accepted.length > 0 &&
            ` · ${t('import.willSkip', { count: summary.total - accepted.length })}`}
        </p>
        <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={() => onConfirm(accepted)} disabled={accepted.length === 0}>
          {t('import.confirmImport')}
        </Button>
      </div>
    </div>
  );
}

function StateIcon({ state }: { state: LineState }) {
  if (state === 'ready') return <Check className="mt-0.5 h-4 w-4 shrink-0 text-done" aria-hidden />;
  if (state === 'review') return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />;
  return <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-late" aria-hidden />;
}

function unitLabel(unit: PreviewLine['unit']): MessageKey {
  switch (unit) {
    case 'box': return 'import.unitBox';
    case 'package': return 'import.unitPackage';
    case 'weight': return 'import.unitWeight';
    case 'unit': return 'import.unitUnit';
    default: return 'import.unitNone';
  }
}

function formatQuantity(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
