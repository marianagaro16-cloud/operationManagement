import { DateTime } from 'luxon';
import {
  BUSINESS_TZ,
  parseBusinessDate,
  toBusinessDate,
  type BusinessDate,
  type Weekday,
} from '@/lib/datetime';
import {
  CONFIG_KIND_FOR_FREQUENCY,
  scheduleConfigSchema,
  type Frequency,
  type MonthlyRule,
  type PlannedOccurrence,
  type ScheduleConfig,
  type ScheduleProblem,
} from './types';
import {
  biweeklyPeriodKey,
  dailyPeriodKey,
  monthlyPeriodKey,
  semiannualPeriodKey,
  weeklyPeriodKey,
} from './periods';

/**
 * The recurrence engine.
 *
 * Pure, synchronous, and free of I/O so it can be exhaustively unit tested and
 * reused from a server action, an Edge Function, or a migration. No React
 * component ever performs these calculations.
 */

export interface TaskDefinitionLike {
  id: string;
  frequency: Frequency;
  schedule_config: unknown;
  is_active: boolean;
  /**
   * First date this task may produce a requirement.
   *
   * Null means "since it existed" — created_at below. The checklist is
   * materialised on demand, so without a floor, browsing to a past month
   * invents requirements for days when the task did not exist and nobody
   * could have done it. Every one of those reads as overdue.
   */
  starts_on?: string | null;
  created_at?: string | null;
}

/**
 * The first date a task can require anything.
 *
 * An explicit starts_on wins; otherwise the day the task was created, because
 * a task cannot have been due before somebody defined it. A definition
 * carrying neither has no floor, which is what the pure callers in the tests
 * rely on.
 */
export function effectiveStart(task: TaskDefinitionLike): BusinessDate | null {
  if (task.starts_on) return task.starts_on.slice(0, 10) as BusinessDate;
  if (task.created_at) return task.created_at.slice(0, 10) as BusinessDate;
  return null;
}

/**
 * Validates a definition's schedule. Returns the parsed config or the reason it
 * cannot be used. Nothing is ever guessed here: an unusable config yields a
 * problem that the Admin UI surfaces as "Scheduling configuration required".
 */
export function resolveScheduleConfig(
  frequency: Frequency,
  raw: unknown,
): { ok: true; config: ScheduleConfig } | { ok: false; problem: ScheduleProblem } {
  if (raw === null || raw === undefined) {
    return {
      ok: false,
      problem: { code: 'missing_config', message: 'No schedule configuration is set.' },
    };
  }
  const parsed = scheduleConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problem: {
        code: 'invalid_config',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
    };
  }
  const expected = CONFIG_KIND_FOR_FREQUENCY[frequency];
  if (parsed.data.kind !== expected) {
    return {
      ok: false,
      problem: {
        code: 'kind_mismatch',
        message: `Frequency "${frequency}" requires a "${expected}" configuration, found "${parsed.data.kind}".`,
      },
    };
  }
  return { ok: true, config: parsed.data };
}

/** True when the task is safe to generate from. Drives the health indicator. */
export function isScheduleConfigured(task: TaskDefinitionLike): boolean {
  return resolveScheduleConfig(task.frequency, task.schedule_config).ok;
}

/**
 * Resolve the nth weekday of a month. `nth = -1` means the last one.
 * Correct across 28/29/30/31-day months because it counts from the real
 * month boundary rather than assuming a fixed length.
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: Weekday,
  nth: 1 | 2 | 3 | 4 | -1,
): BusinessDate {
  if (nth === -1) {
    const end = DateTime.fromObject({ year, month, day: 1 }, { zone: BUSINESS_TZ }).endOf('month');
    const delta = (end.weekday - weekday + 7) % 7;
    return toBusinessDate(end.minus({ days: delta }));
  }
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone: BUSINESS_TZ });
  const delta = (weekday - start.weekday + 7) % 7;
  return toBusinessDate(start.plus({ days: delta + (nth - 1) * 7 }));
}

/** Day-of-month, clamped to the month's real length (31 -> 30 in April). */
export function dayOfMonthClamped(year: number, month: number, day: number): BusinessDate {
  const first = DateTime.fromObject({ year, month, day: 1 }, { zone: BUSINESS_TZ });
  return toBusinessDate(first.set({ day: Math.min(day, first.daysInMonth as number) }));
}

/**
 * Pull a date back to the preceding Friday when it lands on a weekend.
 *
 * A fixed calendar date — 30 June, 31 December — will eventually fall on a
 * Saturday or Sunday, when the warehouse is closed. The work is then done on
 * the last working day BEFORE it rather than after, because these are
 * period-closing activities: an inventory for the half-year cannot
 * meaningfully be counted once the next period has started.
 *
 * Saturday moves back one day, Sunday two. Weekdays are returned unchanged.
 */
export function shiftWeekendToPrecedingFriday(date: BusinessDate): BusinessDate {
  const dt = parseBusinessDate(date);
  if (dt.weekday === 6) return toBusinessDate(dt.minus({ days: 1 })); // Sat -> Fri
  if (dt.weekday === 7) return toBusinessDate(dt.minus({ days: 2 })); // Sun -> Fri
  return date;
}

function monthlyDueDate(year: number, month: number, rule: MonthlyRule): BusinessDate {
  return rule.type === 'dayOfMonth'
    ? dayOfMonthClamped(year, month, rule.day)
    : nthWeekdayOfMonth(year, month, rule.weekday, rule.nth);
}

/**
 * Generate every requirement whose DUE DATE falls in [rangeStart, rangeEnd].
 *
 * Deliberately returns plans rather than writing anything: persistence is the
 * caller's concern, which keeps the engine testable and lets the same code run
 * during seeding, on-demand materialisation, and scheduled generation.
 */
export function generateOccurrences(
  task: TaskDefinitionLike,
  rangeStart: BusinessDate,
  rangeEnd: BusinessDate,
): PlannedOccurrence[] {
  const resolved = resolveScheduleConfig(task.frequency, task.schedule_config);
  // Never invent dates for an unconfigured task.
  if (!resolved.ok) return [];

  const config = resolved.config;
  // The window never begins before the task does. Clamped here rather than
  // filtered afterwards, so a weekly or monthly rule anchors on the first
  // real period instead of on a period the task did not exist for.
  const floor = effectiveStart(task);
  const from = floor && floor > rangeStart ? floor : rangeStart;
  const start = parseBusinessDate(from);
  const end = parseBusinessDate(rangeEnd);
  if (end < start) return [];

  const out: PlannedOccurrence[] = [];

  switch (config.kind) {
    case 'daily': {
      const allowed = config.weekdays && config.weekdays.length > 0 ? new Set(config.weekdays) : null;
      for (let d = start; d <= end; d = d.plus({ days: 1 })) {
        if (allowed && !allowed.has(d.weekday as Weekday)) continue;
        const date = toBusinessDate(d);
        out.push({ periodKey: dailyPeriodKey(date), dueDate: date });
      }
      break;
    }

    case 'weekly': {
      // Walk ISO weeks; one requirement per week, due on the preferred weekday.
      let cursor = start.startOf('week');
      while (cursor <= end) {
        const due = cursor.plus({ days: config.weekday - 1 });
        const dueDate = toBusinessDate(due);
        if (due >= start && due <= end) {
          out.push({ periodKey: weeklyPeriodKey(dueDate), dueDate });
        }
        cursor = cursor.plus({ weeks: 1 });
      }
      break;
    }

    case 'biweekly': {
      const anchor = parseBusinessDate(config.anchorDate);
      // Jump straight to the first cycle at/after rangeStart.
      const daysFromAnchor = Math.round(start.diff(anchor, 'days').days);
      const firstCycle = daysFromAnchor <= 0 ? 0 : Math.ceil(daysFromAnchor / 14);
      for (let c = firstCycle; ; c++) {
        const due = anchor.plus({ days: c * 14 });
        if (due > end) break;
        if (due >= start) {
          const dueDate = toBusinessDate(due);
          out.push({ periodKey: biweeklyPeriodKey(dueDate), dueDate });
        }
      }
      break;
    }

    case 'monthly': {
      let cursor = start.startOf('month');
      while (cursor <= end) {
        const dueDate = monthlyDueDate(cursor.year, cursor.month, config.rule);
        const due = parseBusinessDate(dueDate);
        if (due >= start && due <= end) {
          out.push({ periodKey: monthlyPeriodKey(dueDate), dueDate });
        }
        cursor = cursor.plus({ months: 1 });
      }
      break;
    }

    case 'semiannual': {
      // Widen by a year on each side: a scheduled date can shift back across
      // a year boundary (1 January on a Sunday becomes 30 December), and the
      // shifted date is what has to fall inside the range.
      for (let year = start.year - 1; year <= end.year + 1; year++) {
        for (const md of config.dates) {
          const scheduled = dayOfMonthClamped(year, md.month, md.day);
          const dueDate = shiftWeekendToPrecedingFriday(scheduled);
          const due = parseBusinessDate(dueDate);
          if (due >= start && due <= end) {
            // The period key comes from the SCHEDULED date, not the shifted
            // one. Otherwise a date pulled back over a year boundary would be
            // filed under the wrong half-year and could collide with it.
            out.push({ periodKey: semiannualPeriodKey(scheduled), dueDate });
          }
        }
      }
      break;
    }
  }

  // Defensive: collapse any duplicate period keys so the "one requirement per
  // period" invariant holds even if a config produces two dates in one period
  // (e.g. an admin setting both semiannual dates inside the same half-year).
  const seen = new Map<string, PlannedOccurrence>();
  for (const o of out) if (!seen.has(o.periodKey)) seen.set(o.periodKey, o);
  return [...seen.values()].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}

/** An occurrence is overdue when its due date has passed and it is still open. */
export function isOverdue(
  status: string,
  dueDate: BusinessDate,
  today: BusinessDate,
): boolean {
  return status === 'pending' && dueDate < today;
}

/** How many business days late an open occurrence is. */
export function daysLate(dueDate: BusinessDate, today: BusinessDate): number {
  return Math.max(0, Math.round(parseBusinessDate(today).diff(parseBusinessDate(dueDate), 'days').days));
}
