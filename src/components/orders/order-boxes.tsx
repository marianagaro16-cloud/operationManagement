'use client';

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Input, Select } from '@/components/ui/primitives';
import { boxCount, formatKg } from '@/domain/orders/weight';
import { setOrderBoxQuantity } from '@/server/order-actions';
import type { BoxType, OrderWithProgress } from '@/types/orders';
import { useOrderError } from './order-fulfilment';

/**
 * The active box types, for every order card on a screen.
 *
 * Provided once by the Orders board rather than threaded through each tab.
 * Null outside a provider, which is how a card knows boxes are not recorded
 * from where it is shown.
 */
const BoxTypesContext = createContext<BoxType[] | null>(null);

export function BoxTypesProvider({ boxTypes, children }: { boxTypes: BoxType[]; children: ReactNode }) {
  return <BoxTypesContext.Provider value={boxTypes}>{children}</BoxTypesContext.Provider>;
}

export function useBoxTypes(): BoxType[] | null {
  return useContext(BoxTypesContext);
}

/** "60×40×30 cm", or nothing when any side is unknown. */
export function boxSize(type: Pick<BoxType, 'length_cm' | 'width_cm' | 'height_cm'>): string | null {
  const sides = [type.length_cm, type.width_cm, type.height_cm];
  if (sides.some((s) => s === null || s === '')) return null;
  return `${sides.map((s) => Number(s)).join('×')} cm`;
}

/**
 * The boxes an order is packed in, on its preparation card.
 *
 * The number is TYPED: whoever packs counts the boxes and writes how many,
 * rather than tapping + once per box. It used to be a tap per box, which is
 * fine for two and wrong for eleven.
 *
 * Editable until the order is Shipped — boxes are often only settled when
 * loading — and required before it can be marked Ready.
 */
export function OrderBoxesEditor({ order }: { order: OrderWithProgress }) {
  const { t } = useI18n();
  const router = useRouter();
  const translate = useOrderError();
  const boxTypes = useBoxTypes() ?? [];
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const boxes = [...(order.boxes ?? [])].sort(
    (a, b) => a.box_type.sort_order - b.box_type.sort_order || a.box_type.name.localeCompare(b.box_type.name),
  );
  const unused = boxTypes.filter((bt) => !boxes.some((b) => b.box_type_id === bt.id));
  const locked = Boolean(order.shipped_at) || order.status === 'cancelled';
  // A Ready order keeps at least one box, so its last one cannot be taken away.
  const lastBox = Boolean(order.ready_at) && boxCount(boxes) === 1;

  // Nothing to show: no box types exist yet, and none were recorded before.
  if (boxTypes.length === 0 && boxes.length === 0) return null;

  /** Resolves false when the server refused, so a typed field can go back. */
  function set(boxTypeId: string, quantity: number): Promise<boolean> {
    setError(null);
    return new Promise((resolve) => {
      startTransition(async () => {
        const res = await setOrderBoxQuantity(order.id, boxTypeId, quantity);
        if (!res.ok) {
          setError(translate(res.error));
          return resolve(false);
        }
        router.refresh();
        resolve(true);
      });
    });
  }

  return (
    <div>
      <p className="border-y border-border bg-surface-2/40 px-3.5 py-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
        {t('orders.boxes')}
      </p>
      <ul className="divide-y divide-border">
        {boxes.map((b) => {
          const size = boxSize(b.box_type);
          return (
            <li key={b.id} className="flex items-center gap-3 px-3.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{b.box_type.name}</p>
                <p className="truncate text-[11.5px] tabular text-muted">
                  {[size, formatKg(Number(b.box_type.empty_weight_kg))].filter(Boolean).join(' · ')}
                </p>
              </div>
              {locked ? (
                <span className="w-9 shrink-0 text-center text-[15px] font-semibold tabular">{b.quantity}</span>
              ) : (
                <BoxQuantityInput
                  quantity={b.quantity}
                  name={b.box_type.name}
                  // A Ready order keeps at least one box: its last one cannot
                  // be typed away either.
                  minimum={lastBox ? 1 : 0}
                  disabled={pending}
                  onCommit={(quantity) => set(b.box_type_id, quantity)}
                />
              )}
            </li>
          );
        })}
      </ul>

      {!locked && unused.length > 0 && (
        <div className="px-3.5 py-2">
          <Select
            value=""
            disabled={pending}
            onChange={(e) => { if (e.target.value) set(e.target.value, 1); }}
            aria-label={t('orders.addBox')}
            className="max-w-xs"
          >
            <option value="">{t('orders.addBox')}</option>
            {unused.map((bt) => (
              <option key={bt.id} value={bt.id}>
                {[bt.name, boxSize(bt), formatKg(Number(bt.empty_weight_kg))].filter(Boolean).join(' · ')}
              </option>
            ))}
          </Select>
        </div>
      )}

      {error && <p className="px-3.5 pb-2 text-[12px] text-late">{error}</p>}
    </div>
  );
}

/**
 * How many boxes of one type: typed, saved by itself.
 *
 * Saving happens a moment after the typing stops, and immediately on leaving
 * the field or pressing Enter — so a number that was typed is a number that
 * was recorded, without a button to remember on a phone held in one hand
 * beside a pallet.
 *
 * An empty field is not zero. Zero removes the box type, and somebody
 * halfway through replacing "2" with "12" has an empty field for an instant;
 * treating that as zero would delete the row under their fingers.
 *
 * A number the server refuses — a Ready order may not lose its boxes — snaps
 * back to what is actually recorded, beside the reason. A field left showing
 * a figure nobody kept is worse than no field at all.
 */
function BoxQuantityInput({
  quantity,
  name,
  minimum,
  disabled,
  onCommit,
}: {
  quantity: number;
  name: string;
  /** 1 where the order may not lose its last box, 0 otherwise. */
  minimum: number;
  disabled: boolean;
  /** False when the server refused the number. */
  onCommit: (quantity: number) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(quantity));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What the server says wins whenever it changes underneath.
  useEffect(() => {
    setDraft(String(quantity));
  }, [quantity]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    const next = Number(value);
    if (value.trim() === '' || !Number.isFinite(next)) { setDraft(String(quantity)); return; }
    const clamped = Math.min(999, Math.max(minimum, Math.floor(next)));
    setDraft(String(clamped));
    if (clamped !== quantity) {
      void onCommit(clamped).then((ok) => { if (!ok) setDraft(String(quantity)); });
    }
  };

  return (
    <Input
      value={draft}
      onChange={(e) => {
        const value = e.target.value.replace(/[^\d]/g, '');
        setDraft(value);
        if (timer.current) clearTimeout(timer.current);
        // Long enough to type a second digit, short enough to feel saved.
        timer.current = setTimeout(() => commit(value), 800);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onFocus={(e) => e.currentTarget.select()}
      disabled={disabled}
      inputMode="numeric"
      aria-label={t('orders.boxCountFor', { name })}
      className="w-16 shrink-0 text-center text-[15px] font-semibold tabular"
    />
  );
}
