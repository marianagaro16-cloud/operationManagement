'use client';

import { useState, useTransition } from 'react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/primitives';
import { expandPlanDates } from '@/domain/recurrence/planning';
import { planInventories, planTasks } from '@/server/planning-actions';
import { WEEKDAY, type BusinessDate, type Weekday } from '@/lib/datetime';
import type { Frequency } from '@/domain/recurrence/types';

export interface PlannableTask {
  id: string;
  title: string;
  frequency: Frequency;
}
export interface PlannableTemplate {
  id: string;
  name: string;
}

const WEEKDAYS: Weekday[] = [
  WEEKDAY.MONDAY,
  WEEKDAY.TUESDAY,
  WEEKDAY.WEDNESDAY,
  WEEKDAY.THURSDAY,
  WEEKDAY.FRIDAY,
  WEEKDAY.SATURDAY,
  WEEKDAY.SUNDAY,
];

/**
 * Placing work on dates.
 *
 * One dialog for both jobs. Given a single date it is "add this to Tuesday";
 * given a range it is "plan the week" or "plan the month", and the weekday
 * chips narrow which days inside that range are used.
 *
 * The date arithmetic is `expandPlanDates` in the domain layer, so what the
 * preview counts and what the server writes come from the same function
 * rather than two implementations that can drift.
 */
export function PlanDialog({
  open,
  onClose,
  from,
  to,
  tasks,
  templates,
  today,
  title,
}: {
  open: boolean;
  onClose: () => void;
  from: BusinessDate;
  to: BusinessDate;
  tasks: PlannableTask[];
  templates: PlannableTemplate[];
  today: BusinessDate;
  title: string;
}) {
  const { t, formatDate } = useI18n();
  const [taskIds, setTaskIds] = useState<Set<string>>(new Set());
  const [templateIds, setTemplateIds] = useState<Set<string>>(new Set());
  const [weekdays, setWeekdays] = useState<Set<Weekday>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isRange = from !== to;
  // Past days are dropped: work placed on a day that has gone arrives already
  // overdue on somebody's dashboard, which is never what planning meant.
  const dates = expandPlanDates(from, to, [...weekdays]).filter((d) => d >= today);
  const total = (taskIds.size + templateIds.size) * dates.length;

  function toggle<T>(set: Set<T>, value: T, apply: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  }

  function reset() {
    setTaskIds(new Set());
    setTemplateIds(new Set());
    setWeekdays(new Set());
    setError(null);
  }

  /** Stable identifiers from the actions, turned into a sentence. */
  function translate(code: string): string {
    switch (code) {
      case 'not_authorized': return t('plan.errNotAuthorized');
      case 'already_planned': return t('plan.errAlreadyPlanned');
      case 'plan_too_large': return t('plan.errTooLarge');
      case 'nothing_selected': return t('plan.errNothingSelected');
      case 'no_dates': return t('plan.errNoDates');
      case 'task_not_found': return t('plan.errNotFound');
      default: return code;
    }
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      // Two calls rather than one: they are different tables with different
      // permissions, and a manager who may plan tasks but not inventories
      // should still get their tasks placed.
      if (taskIds.size > 0) {
        const res = await planTasks([...taskIds], dates);
        if (!res.ok) return setError(translate(res.error));
      }
      if (templateIds.size > 0) {
        const res = await planInventories([...templateIds], dates);
        if (!res.ok) return setError(translate(res.error));
      }
      reset();
      onClose();
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={
        isRange
          ? `${formatDate(from, 'short')} – ${formatDate(to, 'short')}`
          : formatDate(from, 'weekday')
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={total === 0}>
            {t('plan.confirm', { count: total })}
          </Button>
        </>
      }
    >
      {isRange && (
        <section className="mb-4">
          <p className="mb-1.5 text-[12px] font-medium text-muted">{t('plan.onWeekdays')}</p>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => toggle(weekdays, w, setWeekdays)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                  weekdays.has(w)
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-muted hover:bg-surface-2',
                )}
              >
                {t(`weekday.${w}` as 'weekday.1')}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-subtle">
            {weekdays.size === 0 ? t('plan.everyDay') : t('plan.daysChosen', { count: dates.length })}
          </p>
        </section>
      )}

      <section className="mb-4">
        <p className="mb-1.5 text-[12px] font-medium text-muted">{t('plan.tasks')}</p>
        {/* Taller, and measured against the VIEWPORT rather than a fixed
            13rem: wrapped rows are two or three lines, and a fixed height
            that fitted four single lines fits barely one and a half now.
            A phone gets a shorter list than a laptop, which is the point. */}
        <ul className="max-h-[45vh] space-y-1 overflow-y-auto pr-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent"
                  checked={taskIds.has(task.id)}
                  onChange={() => toggle(taskIds, task.id, setTaskIds)}
                />
                <span className="min-w-0 flex-1 break-words text-[13px]">{task.title}</span>
                <Badge tone="neutral" className="mt-0.5 shrink-0">{t(`frequency.${task.frequency}` as 'frequency.daily')}</Badge>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {templates.length > 0 && (
        <section>
          <p className="mb-1.5 text-[12px] font-medium text-muted">{t('plan.inventories')}</p>
          <ul className="space-y-1">
            {templates.map((tpl) => (
              <li key={tpl.id}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent"
                    checked={templateIds.has(tpl.id)}
                    onChange={() => toggle(templateIds, tpl.id, setTemplateIds)}
                  />
                  <span className="min-w-0 flex-1 break-words text-[13px]">{tpl.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="mt-3 text-[12px] text-late">{error}</p>}
    </Dialog>
  );
}
