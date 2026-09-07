'use client';

import { useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/primitives';
import { SEMIANNUAL_CLOSE_DATES } from '@/domain/inventory/types';
import type { MonthlyRule } from '@/domain/recurrence/types';
import type { InventoryFrequency, InventorySchedule } from '@/types/inventory';
import type { Weekday } from '@/lib/datetime';

/**
 * Schedule configuration for an inventory template.
 *
 * The one thing this editor does that the task equivalent does not is let a
 * monthly template carry SEVERAL days — Colectivo Comestibles is counted on
 * the second Thursday and again on the last Thursday, which a single rule
 * cannot express.
 *
 * Producing `null` is a legitimate outcome: it marks the template as needing
 * configuration rather than inventing a date nobody chose.
 */
export function InventoryScheduleEditor({
  frequency,
  schedule,
  onChange,
}: {
  frequency: InventoryFrequency;
  schedule: InventorySchedule | null;
  onChange: (next: InventorySchedule | null) => void;
}) {
  const { t } = useI18n();

  // The two period-closing dates are fixed by the operation; the engine pulls
  // them back to the preceding Friday when they land at a weekend. Applied in
  // an effect rather than during render, which would be a state update inside
  // the parent's render pass.
  useEffect(() => {
    if (frequency === 'semiannual' && schedule?.kind !== 'semiannual') {
      onChange({ kind: 'semiannual', dates: SEMIANNUAL_CLOSE_DATES });
    }
  }, [frequency, schedule, onChange]);

  const WEEKDAYS: { value: Weekday; key: MessageKey }[] = [
    { value: 1, key: 'weekday.1' },
    { value: 2, key: 'weekday.2' },
    { value: 3, key: 'weekday.3' },
    { value: 4, key: 'weekday.4' },
    { value: 5, key: 'weekday.5' },
    { value: 6, key: 'weekday.6' },
    { value: 7, key: 'weekday.7' },
  ];

  const NTHS: { value: 1 | 2 | 3 | 4 | -1; key: MessageKey }[] = [
    { value: 1, key: 'inventory.nth1' },
    { value: 2, key: 'inventory.nth2' },
    { value: 3, key: 'inventory.nth3' },
    { value: 4, key: 'inventory.nth4' },
    { value: -1, key: 'inventory.nthLast' },
  ];

  if (frequency === 'weekly') {
    const weekday = schedule?.kind === 'weekly' ? schedule.weekday : 5;
    return (
      <Field label={t('inventory.scheduleWeekday')}>
        <Select
          value={String(weekday)}
          onChange={(e) => onChange({ kind: 'weekly', weekday: Number(e.target.value) as Weekday })}
        >
          {WEEKDAYS.map((d) => (
            <option key={d.value} value={d.value}>
              {t(d.key)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (frequency === 'biweekly') {
    const anchor = schedule?.kind === 'biweekly' ? schedule.anchorDate : '';
    return (
      <Field label={t('inventory.schedule')} hint={t('inventory.scheduleRequired')}>
        <Input
          type="date"
          value={anchor}
          onChange={(e) =>
            onChange(e.target.value ? { kind: 'biweekly', anchorDate: e.target.value } : null)
          }
        />
      </Field>
    );
  }

  if (frequency === 'semiannual') {
    return (
      <Field label={t('inventory.schedule')}>
        <p className="text-[12.5px] text-muted">{t('inventory.scheduleSemiannual')}</p>
      </Field>
    );
  }

  // ---- monthly: one or more days per month ----
  const rules: MonthlyRule[] =
    schedule?.kind === 'monthly' ? schedule.rules : [{ type: 'nthWeekday', nth: -1, weekday: 4 }];

  function setRules(next: MonthlyRule[]) {
    onChange(next.length > 0 ? { kind: 'monthly', rules: next } : null);
  }

  return (
    <Field label={t('inventory.scheduleMonthlyRules')}>
      <div className="space-y-2">
        {rules.map((rule, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select
              value={rule.type === 'nthWeekday' ? String(rule.nth) : 'day'}
              onChange={(e) => {
                const next = [...rules];
                next[index] =
                  e.target.value === 'day'
                    ? { type: 'dayOfMonth', day: 1 }
                    : {
                        type: 'nthWeekday',
                        nth: Number(e.target.value) as 1 | 2 | 3 | 4 | -1,
                        weekday: rule.type === 'nthWeekday' ? rule.weekday : 4,
                      };
                setRules(next);
              }}
              aria-label={t('inventory.scheduleNth')}
            >
              {NTHS.map((n) => (
                <option key={n.value} value={n.value}>
                  {t(n.key)}
                </option>
              ))}
              <option value="day">{t('inventory.date')}</option>
            </Select>

            {rule.type === 'nthWeekday' ? (
              <Select
                value={String(rule.weekday)}
                onChange={(e) => {
                  const next = [...rules];
                  next[index] = { ...rule, weekday: Number(e.target.value) as Weekday };
                  setRules(next);
                }}
                aria-label={t('inventory.scheduleWeekday')}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {t(d.key)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type="number"
                min={1}
                max={31}
                value={rule.day}
                onChange={(e) => {
                  const next = [...rules];
                  next[index] = { type: 'dayOfMonth', day: Number(e.target.value) || 1 };
                  setRules(next);
                }}
                aria-label={t('inventory.date')}
              />
            )}

            {rules.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.delete')}
                onClick={() => setRules(rules.filter((_, i) => i !== index))}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        ))}

        {rules.length < 4 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRules([...rules, { type: 'nthWeekday', nth: 2, weekday: 4 }])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('inventory.scheduleAddRule')}
          </Button>
        )}
      </div>
    </Field>
  );
}
