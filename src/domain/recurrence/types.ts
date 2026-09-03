import { z } from 'zod';
import type { BusinessDate, Weekday } from '@/lib/datetime';

/**
 * Frequencies mirror the operational vocabulary of the Excel workbook this
 * system replaces (Diarias / Semanales / Quincenales / Mensuales / Semestrales).
 */
export const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'semiannual'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

const weekdaySchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4),
  z.literal(5), z.literal(6), z.literal(7),
]);

/**
 * Monthly rules are a closed union today but the engine dispatches on `type`,
 * so adding e.g. `lastBusinessDay` later touches only the resolver.
 */
export const monthlyRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dayOfMonth'), day: z.number().int().min(1).max(31) }),
  z.object({
    type: z.literal('nthWeekday'),
    // -1 means "last"
    nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]),
    weekday: weekdaySchema,
  }),
]);
export type MonthlyRule = z.infer<typeof monthlyRuleSchema>;

const monthDaySchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});
export type MonthDay = z.infer<typeof monthDaySchema>;

/**
 * schedule_config is stored as JSONB. Every variant is validated before it can
 * reach the database, and again before the engine will generate from it.
 */
export const scheduleConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('daily'),
    /** Restrict to certain ISO weekdays. Omitted/empty = every day. */
    weekdays: z.array(weekdaySchema).optional(),
  }),
  z.object({
    kind: z.literal('weekly'),
    /** The preferred day. Completion anywhere in the ISO week still satisfies it. */
    weekday: weekdaySchema,
  }),
  z.object({
    kind: z.literal('biweekly'),
    /** Every occurrence is anchorDate + 14n. Required — never inferred. */
    anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    kind: z.literal('monthly'),
    rule: monthlyRuleSchema,
  }),
  z.object({
    kind: z.literal('semiannual'),
    /** Exactly two dates, one per half-year. */
    dates: z.tuple([monthDaySchema, monthDaySchema]),
  }),
]);
export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;

/** The frequency a config is valid for — guards against mismatched pairs. */
export const CONFIG_KIND_FOR_FREQUENCY: Record<Frequency, ScheduleConfig['kind']> = {
  daily: 'daily',
  weekly: 'weekly',
  biweekly: 'biweekly',
  monthly: 'monthly',
  semiannual: 'semiannual',
};

/** Defined defaults, applied only where the requirements specify one. */
// The warehouse does not operate at weekends, so a daily task means every
// working day, not every calendar day.
export const DEFAULT_DAILY_WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
export const DEFAULT_WEEKLY_WEEKDAY: Weekday = 2; // Tuesday
export const DEFAULT_MONTHLY_RULE: MonthlyRule = { type: 'nthWeekday', nth: -1, weekday: 4 }; // last Thursday
export const DEFAULT_SEMIANNUAL_DATES: [MonthDay, MonthDay] = [
  { month: 6, day: 30 },
  { month: 12, day: 31 },
];

/** A requirement the engine says must exist, before it is persisted. */
export interface PlannedOccurrence {
  /** Uniquely identifies the recurrence period. UNIQUE(task_id, period_key). */
  periodKey: string;
  dueDate: BusinessDate;
}

export type OccurrenceStatus = 'pending' | 'completed' | 'skipped';

/** Why a task cannot currently generate occurrences. */
export interface ScheduleProblem {
  code: 'missing_config' | 'kind_mismatch' | 'invalid_config';
  message: string;
}
