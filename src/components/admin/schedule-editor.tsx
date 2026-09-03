'use client';

import { useI18n } from '@/i18n';
import { Field, Input, Select } from '@/components/ui/primitives';
import {
  DEFAULT_DAILY_WEEKDAYS,
  DEFAULT_MONTHLY_RULE,
  DEFAULT_SEMIANNUAL_DATES,
  DEFAULT_WEEKLY_WEEKDAY,
  type Frequency,
  type ScheduleConfig,
} from '@/domain/recurrence/types';
import type { Weekday } from '@/lib/datetime';

/**
 * The schedule form adapts to the chosen frequency, exposing exactly the
 * fields that frequency needs and nothing else.
 *
 * `value === null` is a meaningful state: it means "not configured", which
 * flags the task for the admin rather than fabricating a schedule.
 */
export function ScheduleEditor({
  frequency,
  value,
  onChange,
}: {
  frequency: Frequency;
  value: ScheduleConfig | null;
  onChange: (config: ScheduleConfig | null) => void;
}) {
  const { t } = useI18n();
  const weekdays: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

  switch (frequency) {
    case 'daily': {
      // "Daily" means every WORKING day by default — the warehouse is closed
      // at weekends — but which days count is editable.
      const selected = new Set(
        value?.kind === 'daily' && value.weekdays?.length ? value.weekdays : DEFAULT_DAILY_WEEKDAYS,
      );
      const toggle = (d: Weekday) => {
        const next = new Set(selected);
        if (next.has(d)) next.delete(d);
        else next.add(d);
        // An empty selection would mean "never"; fall back to every day,
        // which is what an unrestricted daily task means.
        const list = [...next].sort((a, b) => a - b) as Weekday[];
        onChange({ kind: 'daily', weekdays: list.length ? list : undefined });
      };

      return (
        <Field label={t('admin.dailyWeekdays')} hint={t('admin.dailyWeekdaysHint')}>
          <div className="flex flex-wrap gap-1.5">
            {weekdays.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggle(d)}
                aria-pressed={selected.has(d)}
                className={
                  'rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ' +
                  (selected.has(d)
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-surface text-muted hover:text-fg')
                }
              >
                {t(`weekday.${d}` as 'weekday.1').slice(0, 3)}
              </button>
            ))}
          </div>
        </Field>
      );
    }

    case 'weekly': {
      const current = value?.kind === 'weekly' ? value.weekday : DEFAULT_WEEKLY_WEEKDAY;
      return (
        <Field label={t('admin.weeklyDay')} hint={t('admin.weeklyDayHint')} htmlFor="weekly-day">
          <Select
            id="weekly-day"
            value={current}
            onChange={(e) => onChange({ kind: 'weekly', weekday: Number(e.target.value) as Weekday })}
          >
            {weekdays.map((d) => (
              <option key={d} value={d}>
                {t(`weekday.${d}` as 'weekday.1')}
              </option>
            ))}
          </Select>
        </Field>
      );
    }

    case 'biweekly': {
      const anchor = value?.kind === 'biweekly' ? value.anchorDate : '';
      return (
        <Field
          label={t('admin.anchorDate')}
          hint={t('admin.anchorDateHint')}
          error={anchor ? undefined : t('admin.anchorDateMissing')}
          required
          htmlFor="anchor-date"
        >
          <Input
            id="anchor-date"
            type="date"
            value={anchor}
            onChange={(e) =>
              onChange(e.target.value ? { kind: 'biweekly', anchorDate: e.target.value } : null)
            }
          />
        </Field>
      );
    }

    case 'monthly': {
      const rule = value?.kind === 'monthly' ? value.rule : DEFAULT_MONTHLY_RULE;
      return (
        <div className="space-y-3">
          <Field label={t('admin.monthlyRule')} htmlFor="monthly-type">
            <Select
              id="monthly-type"
              value={rule.type}
              onChange={(e) =>
                onChange({
                  kind: 'monthly',
                  rule:
                    e.target.value === 'dayOfMonth'
                      ? { type: 'dayOfMonth', day: 1 }
                      : DEFAULT_MONTHLY_RULE,
                })
              }
            >
              <option value="nthWeekday">{t('admin.monthlyNthWeekday')}</option>
              <option value="dayOfMonth">{t('admin.monthlyDayOfMonth')}</option>
            </Select>
          </Field>

          {rule.type === 'dayOfMonth' ? (
            <Field label={t('admin.monthlyDayOfMonth')} htmlFor="monthly-day">
              <Input
                id="monthly-day"
                type="number"
                min={1}
                max={31}
                value={rule.day}
                onChange={(e) =>
                  onChange({
                    kind: 'monthly',
                    rule: { type: 'dayOfMonth', day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) },
                  })
                }
              />
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('admin.monthlyNthWeekday')} htmlFor="monthly-nth">
                <Select
                  id="monthly-nth"
                  value={String(rule.nth)}
                  onChange={(e) =>
                    onChange({
                      kind: 'monthly',
                      rule: { type: 'nthWeekday', nth: Number(e.target.value) as 1 | 2 | 3 | 4 | -1, weekday: rule.weekday },
                    })
                  }
                >
                  <option value="1">{t('admin.nth1')}</option>
                  <option value="2">{t('admin.nth2')}</option>
                  <option value="3">{t('admin.nth3')}</option>
                  <option value="4">{t('admin.nth4')}</option>
                  <option value="-1">{t('admin.nthLast')}</option>
                </Select>
              </Field>
              <Field label={t('admin.weeklyDay')} htmlFor="monthly-weekday">
                <Select
                  id="monthly-weekday"
                  value={rule.weekday}
                  onChange={(e) =>
                    onChange({
                      kind: 'monthly',
                      rule: { type: 'nthWeekday', nth: rule.nth, weekday: Number(e.target.value) as Weekday },
                    })
                  }
                >
                  {weekdays.map((d) => (
                    <option key={d} value={d}>
                      {t(`weekday.${d}` as 'weekday.1')}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
      );
    }

    case 'semiannual': {
      const dates = value?.kind === 'semiannual' ? value.dates : DEFAULT_SEMIANNUAL_DATES;
      const set = (index: 0 | 1, patch: { month?: number; day?: number }) => {
        const next: [typeof dates[0], typeof dates[1]] = [{ ...dates[0] }, { ...dates[1] }];
        next[index] = { ...next[index], ...patch };
        onChange({ kind: 'semiannual', dates: next });
      };

      return (
        <div className="space-y-2">
          <p className="text-[13px] font-medium">{t('admin.semiannualDates')}</p>
          <p className="text-[12px] text-muted">{t('admin.semiannualHint')}</p>
          {([0, 1] as const).map((i) => (
            <div key={i} className="grid grid-cols-2 gap-3">
              <Select
                aria-label={`month-${i}`}
                value={dates[i].month}
                onChange={(e) => set(i, { month: Number(e.target.value) })}
              >
                {Array.from({ length: 12 }, (_, m) => (
                  <option key={m + 1} value={m + 1}>
                    {new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2026, m, 1))}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`day-${i}`}
                type="number"
                min={1}
                max={31}
                value={dates[i].day}
                onChange={(e) => set(i, { day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
              />
            </div>
          ))}
        </div>
      );
    }
  }
}

/** The config a newly chosen frequency starts from. */
export function defaultConfigFor(frequency: Frequency): ScheduleConfig | null {
  switch (frequency) {
    case 'daily':
      return { kind: 'daily', weekdays: DEFAULT_DAILY_WEEKDAYS };
    case 'weekly':
      return { kind: 'weekly', weekday: DEFAULT_WEEKLY_WEEKDAY };
    case 'monthly':
      return { kind: 'monthly', rule: DEFAULT_MONTHLY_RULE };
    case 'semiannual':
      return { kind: 'semiannual', dates: DEFAULT_SEMIANNUAL_DATES };
    case 'biweekly':
      // No default exists for an anchor date, so it stays unconfigured.
      return null;
  }
}
