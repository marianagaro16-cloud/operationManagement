'use client';

import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/primitives';
import { DigitalPendingBadge, StatusBadge, WeekBadge } from './inventory-bits';
import type { InventoryListRow } from '@/types/inventory';

/**
 * Inventory on the dashboard.
 *
 * Deliberately a compact strip, not a second dashboard: today's TASKS remain
 * the focus of that screen, and this exists so a count due today is not
 * something you have to remember to go and look for.
 *
 * Renders nothing at all when there is nothing due — an empty card every day
 * would train people to ignore the space it occupies.
 */
export function InventoryWidget({
  dueToday,
  overdue,
}: {
  dueToday: InventoryListRow[];
  overdue: InventoryListRow[];
}) {
  const { t } = useI18n();
  const rows = [...overdue, ...dueToday];
  if (rows.length === 0) return null;

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <Boxes className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-[15px] font-semibold leading-tight">{t('inventory.title')}</h2>
      </div>

      <ul className="space-y-2">
        {rows.map((row) => {
          const isOverdue = overdue.some((o) => o.id === row.id);
          return (
            <li key={row.id}>
              <Link href={`/inventory/${row.id}`}>
                <Card
                  className={cn(
                    'flex items-center gap-2 p-3 transition-colors hover:bg-surface-2/50',
                    isOverdue && 'border-late/30',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{row.name_snapshot}</p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {isOverdue ? t('inventory.overdue') : t('common.today')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <WeekBadge isoWeek={row.iso_week} />
                    {row.digital_pending_count > 0 ? (
                      <DigitalPendingBadge count={row.digital_pending_count} />
                    ) : (
                      <StatusBadge status={row.status} />
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
