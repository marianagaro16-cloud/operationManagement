'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { localizedTitle } from '@/lib/localized-content';
import { cn } from '@/lib/utils';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';
import { monthRange, weekRange } from '@/domain/recurrence/planning';
import { unplanInventory, unplanTask } from '@/server/planning-actions';
import { BUSINESS_TZ, type BusinessDate } from '@/lib/datetime';
import { PlanDialog, type PlannableTask, type PlannableTemplate } from './plan-dialog';
import type { OccurrenceWithTask } from '@/types/database';
import type { InventoryStatus } from '@/types/inventory';

export interface CalendarInventory {
  id: string;
  inventory_date: BusinessDate;
  name: string;
  status: InventoryStatus;
}

/**
 * The planner.
 *
 * This used to be a read-only month grid whose job was making a recurrence
 * RULE legible as concrete dates. The rules are gone for everything but the
 * daily checklist, so the grid now does the opposite job: it is where a
 * manager PUTS work on days, either one day at a time or a week or month at
 * once.
 *
 * Inventories are shown beside tasks because they are scheduled the same way
 * and by the same people, and a calendar that showed only half of what is
 * planned would be a calendar nobody could plan from.
 */
export function CalendarView({
  occurrences,
  inventories,
  tasks,
  templates,
  month,
  today,
}: {
  occurrences: OccurrenceWithTask[];
  inventories: CalendarInventory[];
  tasks: PlannableTask[];
  templates: PlannableTemplate[];
  month: string; // YYYY-MM-01
  today: string;
}) {
  const { t, locale, formatDate } = useI18n();
  const [selected, setSelected] = useState<string | null>(today);
  const [planning, setPlanning] = useState<{ from: string; to: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const anchor = DateTime.fromISO(month, { zone: BUSINESS_TZ }).setLocale(locale);

  const byDate = useMemo(() => {
    const map = new Map<string, OccurrenceWithTask[]>();
    for (const o of occurrences) {
      const key = o.effective_due_date;
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return map;
  }, [occurrences]);

  const inventoriesByDate = useMemo(() => {
    const map = new Map<string, CalendarInventory[]>();
    for (const i of inventories) {
      const list = map.get(i.inventory_date);
      if (list) list.push(i);
      else map.set(i.inventory_date, [i]);
    }
    return map;
  }, [inventories]);

  // Pad the grid to whole ISO weeks so columns line up under the weekday row.
  const gridStart = anchor.startOf('month').startOf('week');
  const gridEnd = anchor.endOf('month').endOf('week');
  const days: DateTime[] = [];
  for (let d = gridStart; d <= gridEnd; d = d.plus({ days: 1 })) days.push(d);

  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    gridStart.plus({ days: i }).toFormat('ccc'),
  );

  const selectedTasks = selected ? (byDate.get(selected) ?? []) : [];
  const selectedInventories = selected ? (inventoriesByDate.get(selected) ?? []) : [];

  const href = (delta: number) =>
    `/calendar?month=${anchor.plus({ months: delta }).toFormat('yyyy-MM-01')}`;

  function remove(kind: 'task' | 'inventory', id: string) {
    setError(null);
    startTransition(async () => {
      const res = kind === 'task' ? await unplanTask(id) : await unplanInventory(id);
      if (!res.ok) {
        setError(
          res.error === 'inventory_in_use'
            ? t('plan.errInventoryInUse')
            : res.error === 'not_removable'
              ? t('plan.errNotRemovable')
              : res.error,
        );
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold capitalize">{anchor.toFormat('LLLL yyyy')}</h2>
        <div className="flex items-center gap-1">
          <Link
            href={href(-1)}
            aria-label={t('calendar.prev')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href="/calendar"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-2"
          >
            {t('calendar.todayCta')}
          </Link>
          <Link
            href={href(1)}
            aria-label={t('calendar.next')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>

      {/* Bulk planning acts on the SELECTED day's week, and on the month being
          viewed — so what a button will affect is always on screen. */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const base = selected ?? today;
            const { from, to } = weekRange(base);
            setPlanning({ from, to, title: t('plan.week') });
          }}
        >
          {t('plan.week')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const { from, to } = monthRange(anchor.toISODate() as string);
            setPlanning({ from, to, title: t('plan.month') });
          }}
        >
          {t('plan.month')}
        </Button>
      </div>

      {error && <p className="text-[12.5px] text-late">{error}</p>}

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-surface-2/50">
          {weekdayLabels.map((label) => (
            <div key={label} className="px-1 py-1.5 text-center text-2xs font-medium uppercase text-subtle">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((d) => {
            const iso = d.toISODate() as string;
            const items = byDate.get(iso) ?? [];
            const invs = inventoriesByDate.get(iso) ?? [];
            const outside = d.month !== anchor.month;
            const isToday = iso === today;
            const open = items.filter((o) => o.status === 'pending').length;
            const count = items.length + invs.length;

            return (
              <button
                key={iso}
                onClick={() => setSelected(iso)}
                className={cn(
                  'relative min-h-[58px] border-b border-r border-border p-1 text-left transition-colors sm:min-h-[76px]',
                  outside && 'bg-surface-2/30 text-subtle',
                  selected === iso && 'bg-accent/5 ring-1 ring-inset ring-accent/30',
                  'hover:bg-surface-2/60',
                )}
              >
                <span
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular',
                    isToday && 'bg-accent font-semibold text-accent-fg',
                  )}
                >
                  {d.day}
                </span>

                {count > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    <span className="block truncate text-[10px] leading-tight text-muted">
                      {count}
                    </span>
                    <div className="flex gap-0.5">
                      {open > 0 && <span className="h-1 w-1 rounded-full bg-accent" />}
                      {items.some((o) => o.status === 'completed') && (
                        <span className="h-1 w-1 rounded-full bg-done" />
                      )}
                      {items.some((o) => o.status === 'skipped') && (
                        <span className="h-1 w-1 rounded-full bg-skipped" />
                      )}
                      {invs.length > 0 && <span className="h-1 w-1 rounded-full bg-warn" />}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {selected && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-medium capitalize">{formatDate(selected, 'weekday')}</h3>
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                setPlanning({ from: selected, to: selected, title: t('plan.addToDay') })
              }
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('plan.addToDay')}
            </Button>
          </div>

          {selectedTasks.length === 0 && selectedInventories.length === 0 ? (
            <EmptyState title={t('calendar.noOccurrences')} />
          ) : (
            <ul className="space-y-1.5">
              {selectedTasks.map((o) => (
                <li
                  key={o.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <span className="min-w-0 flex-1 break-words text-[13px]">
                    {localizedTitle(o.task, locale)}
                  </span>
                  <Badge tone="neutral" className="mt-0.5 shrink-0">
                    {t(`frequency.${o.task.frequency}` as 'frequency.daily')}
                  </Badge>
                  <StatusChip domain="task" status={o.status} />
                  {/* Only while still pending: a completed or skipped
                      occurrence is the record that it happened. */}
                  {o.status === 'pending' && (
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={pending}
                      aria-label={t('plan.remove')}
                      className="h-7 w-7 text-muted hover:text-late"
                      onClick={() => remove('task', o.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}

              {selectedInventories.map((i) => (
                <li
                  key={i.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-warn/30 bg-surface px-3 py-2"
                >
                  <Link
                    href={`/inventory/${i.id}`}
                    className="min-w-0 flex-1 break-words text-[13px] hover:underline"
                  >
                    {i.name}
                  </Link>
                  <Badge tone="warn">{t('inventory.title')}</Badge>
                  <StatusChip domain="inventory" status={i.status} />
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={pending}
                    aria-label={t('plan.remove')}
                    className="h-7 w-7 text-muted hover:text-late"
                    onClick={() => remove('inventory', i.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {planning && (
        <PlanDialog
          open
          onClose={() => setPlanning(null)}
          from={planning.from}
          to={planning.to}
          title={planning.title}
          tasks={tasks}
          templates={templates}
          today={today}
        />
      )}
    </div>
  );
}
