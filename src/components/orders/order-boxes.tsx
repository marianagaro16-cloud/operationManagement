'use client';

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/primitives';
import { formatKg } from '@/domain/orders/weight';
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
 * Recorded by whoever prepares, one tap per box. Editable until the order is
 * Shipped — boxes are often only settled when loading — and required before
 * it can be marked Ready.
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

  // Nothing to show: no box types exist yet, and none were recorded before.
  if (boxTypes.length === 0 && boxes.length === 0) return null;

  function set(boxTypeId: string, quantity: number) {
    setError(null);
    startTransition(async () => {
      const res = await setOrderBoxQuantity(order.id, boxTypeId, quantity);
      if (!res.ok) return setError(translate(res.error));
      router.refresh();
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
              {!locked && (
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => set(b.box_type_id, b.quantity - 1)}
                  disabled={pending}
                  aria-label={t('orders.fewerBoxes', { name: b.box_type.name })}
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
              <span className="w-7 shrink-0 text-center text-[15px] font-semibold tabular">{b.quantity}</span>
              {!locked && (
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => set(b.box_type_id, b.quantity + 1)}
                  disabled={pending || b.quantity >= 999}
                  aria-label={t('orders.moreBoxes', { name: b.box_type.name })}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </Button>
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
