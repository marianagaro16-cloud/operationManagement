'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, ClipboardList, Package } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui/primitives';
import { orderProgress } from '@/domain/orders/progress';
import type { Order } from '@/types/orders';

/**
 * Dashboard widgets for the orders module.
 *
 * Deliberately compact: today's TASKS remain the primary content of the
 * dashboard, so orders contribute two summary tiles and one warning rather
 * than a second full list competing for attention.
 */
export function OrderWidgets({
  toPrepare,
  delivering,
}: {
  toPrepare: Order[];
  delivering: Order[];
}) {
  const { t } = useI18n();
  if (toPrepare.length === 0 && delivering.length === 0) return null;

  // Lines where work has started but is short and unexplained.
  const needsAttention = toPrepare.filter((o) =>
    orderProgress(
      o.lines.map((l) => ({
        ordered_quantity: l.ordered_quantity,
        shortfall_reason: l.shortfall_reason,
        allocations: l.allocations,
      })),
    ).hasUnexplainedShortfall,
  );

  const incomplete = toPrepare.filter((o) => {
    const p = orderProgress(
      o.lines.map((l) => ({
        ordered_quantity: l.ordered_quantity,
        shortfall_reason: l.shortfall_reason,
        allocations: l.allocations,
      })),
    );
    return !p.isComplete;
  });

  return (
    <section className="mb-6">
      <div className="grid grid-cols-2 gap-2.5">
        <Tile
          href="/preparation"
          icon={<ClipboardList className="h-4 w-4" aria-hidden />}
          label={t('prep.title')}
          value={`${incomplete.length} / ${toPrepare.length}`}
          hint={t('orders.remaining')}
          tone={incomplete.length > 0 ? 'accent' : 'done'}
        />
        <Tile
          href="/orders"
          icon={<Package className="h-4 w-4" aria-hidden />}
          label={t('orders.title')}
          value={String(delivering.length)}
          hint={t('orders.deliveryDate')}
          tone="neutral"
        />
      </div>

      {needsAttention.length > 0 && (
        <Link
          href="/preparation"
          className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.06] px-3.5 py-2.5 transition-colors hover:bg-warn/10"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px]">{t('prep.shortfallRequired')}</span>
          <span className="shrink-0 text-[13px] font-semibold tabular text-warn">
            {needsAttention.length}
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
        </Link>
      )}
    </section>
  );
}

function Tile({
  href,
  icon,
  label,
  value,
  hint,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: 'accent' | 'done' | 'neutral';
}) {
  const color = tone === 'done' ? 'text-done' : tone === 'accent' ? 'text-accent' : 'text-fg';
  return (
    <Link href={href}>
      <Card className="h-full px-3.5 py-3 transition-colors hover:bg-surface-2/50">
        <div className="flex items-center gap-1.5 text-muted">
          {icon}
          <span className="truncate text-[11.5px] font-medium">{label}</span>
        </div>
        <p className={`mt-1 text-xl font-semibold tabular ${color}`}>{value}</p>
        <p className="text-[11px] text-subtle">{hint}</p>
      </Card>
    </Link>
  );
}
