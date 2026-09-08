'use client';

import { useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxHandle } from '@/components/ui/combobox';
import { Input } from '@/components/ui/primitives';
import { boxesRequired } from '@/domain/orders/import/packaging';
import { toQuantity } from '@/domain/orders/progress';
import { productLabel, type Product } from '@/types/orders';

/**
 * The order lines editor — Method A, manual entry.
 *
 * Unchanged in shape from what it replaced: one searchable selector per line,
 * a quantity beside it, a remove button. What is new is that the whole thing
 * can be driven from the keyboard without ever reaching for the mouse:
 *
 *   type "tort 14" -> Enter (product chosen, focus lands in the quantity)
 *   type "20"      -> Enter (line done, a new one appears and is focused)
 *
 * The mouse workflow is untouched — every control is still a control, the
 * Add product button is still there, and nothing depends on a keystroke.
 */

export interface DraftLine {
  id?: string;
  product_id: string;
  ordered_quantity: string;
  note: string;
  /** Verbatim customer text, when the line came from an import. */
  source_text?: string | null;
}

export function emptyLine(): DraftLine {
  return { product_id: '', ordered_quantity: '', note: '' };
}

export function OrderLineEditor({
  lines,
  onChange,
  products,
  disabled,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  /** Already narrowed by the caller to what this order may use. */
  products: Product[];
  disabled?: boolean;
}) {
  const { t } = useI18n();

  // Focus is handed between three moving targets — the quantity of the line
  // just filled, and the product selector of a line that does not exist yet —
  // so the refs are keyed by index rather than held one at a time.
  const quantityRefs = useRef<(HTMLInputElement | null)[]>([]);
  const productRefs = useRef<(ComboboxHandle | null)[]>([]);

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const addLine = () => onChange([...lines, emptyLine()]);

  /**
   * Enter on the quantity finishes the line.
   *
   * On the last line it appends the next one and focuses it; on an earlier
   * line it moves to the next line's product, so a correction made halfway up
   * the order carries on down rather than jumping to the end.
   *
   * The new field is focused after paint — React has not rendered the row at
   * the moment the handler runs, so there is nothing to focus yet.
   */
  function onQuantityKeyDown(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== 'Enter') return;
    // Inside a <dialog>, Enter in a field would otherwise submit or bubble.
    e.preventDefault();

    const isLast = i === lines.length - 1;
    if (isLast) {
      if (!lines[i].product_id || !(toQuantity(lines[i].ordered_quantity) > 0)) return;
      addLine();
    }
    requestAnimationFrame(() => productRefs.current[i + 1]?.focus());
  }

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        const product = products.find((p) => p.id === line.product_id);
        const quantity = toQuantity(line.ordered_quantity);
        // Shown, never stored, and never substituted for the quantity: an
        // order for 14 with 6 to a box is an order for 14 that needs 3 boxes.
        const boxes = product ? boxesRequired(quantity, toNumberOrNull(product.units_per_box)) : null;

        return (
          <div key={i}>
            <div className="flex items-start gap-2">
              <Combobox
                className="min-w-0 flex-1"
                handleRef={(h) => { productRefs.current[i] = h; }}
                items={products}
                value={line.product_id || null}
                onChange={(id) => setLine(i, { product_id: id ?? '' })}
                // Choosing a product lands in its quantity. This is the half
                // of the keyboard flow that saves the most reaching.
                onCommitted={() => requestAnimationFrame(() => quantityRefs.current[i]?.focus())}
                getKey={(p) => p.id}
                getLabel={(p) => (p.code ? `${p.code} · ${productLabel(p)}` : productLabel(p))}
                // Code AND name, so "0073", "tortilla" and "1kg" all find it.
                getSearchText={(p) => `${p.code ?? ''} ${p.name ?? ''} ${p.family}`}
                placeholder={t('orders.searchProduct')}
                emptyMessage={t('orders.noProductsFound')}
                disabled={disabled}
                renderOption={(p) => (
                  <span className="flex items-baseline gap-2">
                    <span className="w-12 shrink-0 tabular text-[11.5px] text-subtle">
                      {p.code ?? '—'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{productLabel(p)}</span>
                  </span>
                )}
              />
              <Input
                ref={(el) => { quantityRefs.current[i] = el; }}
                value={line.ordered_quantity}
                onChange={(e) => setLine(i, { ordered_quantity: e.target.value })}
                onKeyDown={(e) => onQuantityKeyDown(e, i)}
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                className="w-20 shrink-0"
                aria-label={t('orders.quantity')}
                disabled={disabled}
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onChange(lines.filter((_, j) => j !== i))}
                aria-label={t('orders.removeLine')}
                disabled={disabled || lines.length === 1}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>

            {(boxes !== null || line.source_text) && (
              <p className="mt-0.5 pl-1 text-[11.5px] text-muted">
                {boxes !== null && t('orders.boxesRequired', { count: boxes })}
                {boxes !== null && line.source_text && ' · '}
                {line.source_text && t('import.fromText', { text: line.source_text })}
              </p>
            )}
          </div>
        );
      })}

      <Button size="sm" variant="secondary" className="mt-2" onClick={addLine} disabled={disabled}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t('orders.addProduct')}
      </Button>
    </div>
  );
}

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
