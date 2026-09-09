'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, ClipboardList, Package, StickyNote } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { OrderWithProgress } from '@/types/orders';

/**
 * Dashboard widgets for the orders module.
 *
 * Deliberately compact: today's TASKS remain the primary content of the
 * dashboard, so orders contribute two summary tiles and one warning rather
 * than a second full list competing for attention.
 */
/**
 * A note somebody wrote, made findable at a glance.
 *
 * Notes used to render as grey text on a grey block — the same treatment as
 * every other secondary line on the card — so "deliver before 10" was
 * invisible next to the delivery method. They now carry their own colour and
 * a marker down the left edge.
 *
 * Deliberately NOT amber. On these very screens amber means short, late or
 * needs attention, and dressing an instruction as a problem is a worse error
 * than leaving it grey.
 *
 * One component for all three places an order note appears — the order list,
 * the order page and the preparation card — so they cannot drift apart. The
 * caller passes only the chrome that differs: padding, and whether it sits
 * flush against a card edge or floats inside one.
 */
export function NoteBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 border-l-2 border-note bg-note/[0.07] text-[12.5px] text-note',
        className,
      )}
    >
      <StickyNote className="mt-[2px] h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

export function OrderWidgets({
  toPrepare,
  carriedOver,
  delivering,
  canManage,
}: {
  toPrepare: OrderWithProgress[];
  /** Unfinished orders from earlier preparation days. */
  carriedOver: OrderWithProgress[];
  delivering: OrderWithProgress[];
  /** Whether this viewer can open Order Control at all. */
  canManage: boolean;
}) {
  const { t } = useI18n();
  if (toPrepare.length === 0 && delivering.length === 0 && carriedOver.length === 0) return null;

  // Two filters over one already-computed field. This used to be two full
  // passes of orderProgress() over the same array in the same render.
  //
  // Carried-over work counts towards "needs attention" — it is the most
  // attention-worthy thing on the screen — but not towards the tile, which is
  // about today's own list.
  const needsAttention = [...toPrepare, ...carriedOver].filter(
    (o) => o.progress.hasUnexplainedShortfall,
  );
  const incomplete = toPrepare.filter((o) => !o.progress.isComplete);

  return (
    <section className="mb-6">
      <div className={cn('grid gap-2.5', canManage ? 'grid-cols-2' : 'grid-cols-1')}>
        <Tile
          href="/preparation"
          icon={<ClipboardList className="h-4 w-4" aria-hidden />}
          label={t('prep.title')}
          value={`${incomplete.length} / ${toPrepare.length}`}
          hint={t('orders.remaining')}
          tone={incomplete.length > 0 ? 'accent' : 'done'}
        />
        {/* The deliveries tile opens the order book, so it is only offered to
            someone who can actually get there — otherwise it is a tile that
            bounces the person straight back to this page. Preparation, which
            IS their work, keeps its tile and takes the full width. */}
        {canManage && (
          <Tile
            href="/orders"
            icon={<Package className="h-4 w-4" aria-hidden />}
            label={t('orders.title')}
            value={String(delivering.length)}
            hint={t('orders.deliveryDate')}
            tone="neutral"
          />
        )}
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
