import {
  dayOfMonthClamped,
  nthWeekdayOfMonth,
  shiftWeekendToPrecedingFriday,
} from '@/domain/recurrence/engine';
import type { MonthlyRule } from '@/domain/recurrence/types';
import { parseBusinessDate, toBusinessDate, type BusinessDate } from '@/lib/datetime';
import {
  SCHEDULE_KIND_FOR_FREQUENCY,
  inventoryScheduleSchema,
  type InventoryFrequency,
  type InventorySchedule,
  type InventoryScheduleProblem,
  type PlannedInventory,
} from './types';

/**
 * Inventory scheduling.
 *
 * Pure and synchronous, like the task recurrence engine, so it can be
 * exhaustively unit tested and run identically from a server action, the cron
 * route, and the seed script.
 *
 * Every date calculation delegates to the existing recurrence engine
 * (nthWeekdayOfMonth, dayOfMonthClamped, shiftWeekendToPrecedingFriday).
 * Nothing about "last Thursday" or the weekend rule is reimplemented here.
 */

export function resolveInventorySchedule(
  frequency: InventoryFrequency,
  raw: unknown,
): { ok: true; schedule: InventorySchedule } | { ok: false; problem: InventoryScheduleProblem } {
  if (raw === null || raw === undefined) {
    return {
      ok: false,
      problem: { code: 'missing_config', message: 'No schedule configuration is set.' },
    };
  }
  const parsed = inventoryScheduleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problem: {
        code: 'invalid_config',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
    };
  }
  const expected = SCHEDULE_KIND_FOR_FREQUENCY[frequency];
  if (parsed.data.kind !== expected) {
    return {
      ok: false,
      problem: {
        code: 'kind_mismatch',
        message: `Frequency "${frequency}" requires a "${expected}" configuration, found "${parsed.data.kind}".`,
      },
    };
  }
  return { ok: true, schedule: parsed.data };
}

export function isInventoryScheduleConfigured(
  frequency: InventoryFrequency,
  raw: unknown,
): boolean {
  return resolveInventorySchedule(frequency, raw).ok;
}

/** ISO calendar week of a business date — the "KW" the operation counts in. */
export function calendarWeek(date: BusinessDate): { isoYear: number; isoWeek: number } {
  const dt = parseBusinessDate(date);
  return { isoYear: dt.weekYear, isoWeek: dt.weekNumber };
}

/** "KW 37" style label, used in headings and report filters. */
export function formatCalendarWeek(isoWeek: number): string {
  return `KW ${String(isoWeek).padStart(2, '0')}`;
}

function monthlyDate(year: number, month: number, rule: MonthlyRule): BusinessDate {
  return rule.type === 'dayOfMonth'
    ? dayOfMonthClamped(year, month, rule.day)
    : nthWeekdayOfMonth(year, month, rule.weekday, rule.nth);
}

function plan(inventoryDate: BusinessDate, periodKey: string): PlannedInventory {
  const { isoYear, isoWeek } = calendarWeek(inventoryDate);
  return { inventoryDate, periodKey, isoYear, isoWeek };
}

/**
 * Every inventory the schedule requires with a date in [rangeStart, rangeEnd].
 *
 * Returns plans rather than writing: persistence is the caller's concern, and
 * the identity of an inventory instance is (template, date) — see the note on
 * periodKey below.
 *
 * periodKey is a REPORTING LABEL, not an identity. Unlike task occurrences —
 * where UNIQUE(task_id, period_key) enforces "at most one per period" — an
 * inventory template legitimately produces two instances in one month, so the
 * database keys instances by (template_id, inventory_date) instead. That is
 * also what makes "KW 37, KW 38 and KW 39 stay three separate records"
 * structurally true rather than a convention.
 */
export function generateInventories(
  frequency: InventoryFrequency,
  rawSchedule: unknown,
  rangeStart: BusinessDate,
  rangeEnd: BusinessDate,
): PlannedInventory[] {
  const resolved = resolveInventorySchedule(frequency, rawSchedule);
  // Never invent a date for an unconfigured template.
  if (!resolved.ok) return [];

  const schedule = resolved.schedule;
  const start = parseBusinessDate(rangeStart);
  const end = parseBusinessDate(rangeEnd);
  if (end < start) return [];

  const out: PlannedInventory[] = [];

  switch (schedule.kind) {
    case 'weekly': {
      let cursor = start.startOf('week');
      while (cursor <= end) {
        const due = cursor.plus({ days: schedule.weekday - 1 });
        if (due >= start && due <= end) {
          const date = toBusinessDate(due);
          out.push(plan(date, `${due.weekYear}-W${String(due.weekNumber).padStart(2, '0')}`));
        }
        cursor = cursor.plus({ weeks: 1 });
      }
      break;
    }

    case 'biweekly': {
      const anchor = parseBusinessDate(schedule.anchorDate);
      const daysFromAnchor = Math.round(start.diff(anchor, 'days').days);
      const firstCycle = daysFromAnchor <= 0 ? 0 : Math.ceil(daysFromAnchor / 14);
      for (let c = firstCycle; ; c++) {
        const due = anchor.plus({ days: c * 14 });
        if (due > end) break;
        if (due >= start) {
          const date = toBusinessDate(due);
          out.push(plan(date, `BW-${date}`));
        }
      }
      break;
    }

    case 'monthly': {
      const multiple = schedule.rules.length > 1;
      let cursor = start.startOf('month');
      while (cursor <= end) {
        // Resolve every rule for the month, then order by date so the "#1/#2"
        // suffix is stable regardless of the order an admin added the rules in.
        const dates = schedule.rules
          .map((rule) => monthlyDate(cursor.year, cursor.month, rule))
          .sort();
        const month = `${cursor.year}-${String(cursor.month).padStart(2, '0')}`;
        dates.forEach((date, index) => {
          const due = parseBusinessDate(date);
          if (due < start || due > end) return;
          out.push(plan(date, multiple ? `${month}#${index + 1}` : month));
        });
        cursor = cursor.plus({ months: 1 });
      }
      break;
    }

    case 'semiannual': {
      // Widen by a year each side: 1 January on a Sunday is pulled back to
      // 30 December of the previous year, and it is the SHIFTED date that has
      // to land inside the range.
      for (let year = start.year - 1; year <= end.year + 1; year++) {
        for (const md of schedule.dates) {
          const scheduled = dayOfMonthClamped(year, md.month, md.day);
          // 30 June / 31 December on a Saturday or Sunday moves to the Friday
          // before, because a period-closing count cannot meaningfully happen
          // once the next period has already started.
          const date = shiftWeekendToPrecedingFriday(scheduled);
          const due = parseBusinessDate(date);
          if (due < start || due > end) continue;
          // Keyed by the SCHEDULED date, so a date pulled back across a year
          // boundary is still filed under the half-year it closes.
          const sd = parseBusinessDate(scheduled);
          out.push(plan(date, `${sd.year}-H${sd.month <= 6 ? 1 : 2}`));
        }
      }
      break;
    }
  }

  // Two rules can resolve to the same day (an admin configuring both "last
  // Thursday" and "day 25" in a month where they coincide). One inventory per
  // template per date, always.
  const seen = new Map<BusinessDate, PlannedInventory>();
  for (const p of out) if (!seen.has(p.inventoryDate)) seen.set(p.inventoryDate, p);
  return [...seen.values()].sort((a, b) => (a.inventoryDate < b.inventoryDate ? -1 : 1));
}

/** The next scheduled date on or after `from`. Powers "Upcoming" on the overview. */
export function nextInventoryDate(
  frequency: InventoryFrequency,
  rawSchedule: unknown,
  from: BusinessDate,
  horizonDays = 400,
): BusinessDate | null {
  const to = toBusinessDate(parseBusinessDate(from).plus({ days: horizonDays }));
  return generateInventories(frequency, rawSchedule, from, to)[0]?.inventoryDate ?? null;
}
