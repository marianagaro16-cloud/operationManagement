import { z } from 'zod';
import {
  monthDaySchema,
  monthlyRuleSchema,
  weekdaySchema,
  type MonthDay,
  type MonthlyRule,
} from '@/domain/recurrence/types';
import type { BusinessDate } from '@/lib/datetime';

/**
 * The Inventory domain vocabulary.
 *
 * Deliberately its own module rather than an extension of the task recurrence
 * types: an inventory is a specialised operational object with counting,
 * reconciliation and audit semantics that a generic task does not have. It
 * REUSES the recurrence engine's date mathematics (see ./schedule) instead of
 * reimplementing it — there is exactly one implementation of "last Thursday of
 * the month" and "pull a weekend date back to the preceding Friday" in this
 * codebase.
 */

/* ----------------------------- inventory kind ---------------------------- */

/**
 * What a single physical count record consists of. This is the ONE decision
 * that shapes the entry UI, the validation and the meaning of "stock":
 *
 *   expiry   — quantity + optional expiry date  (Masamor/Del Barrio, Colectivo)
 *   lot      — quantity + optional lot number + optional expiry (Materia Prima)
 *   location — quantity per configured location (Empaques)
 *
 * Stock is ALWAYS the sum of the underlying records, never typed by hand.
 */
export const INVENTORY_KINDS = ['expiry', 'lot', 'location'] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

/* -------------------------------- statuses ------------------------------- */

/**
 * Four statuses, exactly as specified. "Inventory Digital: Pending" is
 * deliberately NOT one of them — it is an orthogonal condition (the admin has
 * not entered a digital value yet) that can coexist with any status, and
 * modelling it as a fifth status would make "in progress AND pending"
 * inexpressible.
 */
export const INVENTORY_STATUSES = ['in_progress', 'completed', 'to_review', 'resolved'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

/* ------------------------------- frequency ------------------------------- */

/**
 * No `daily`: a physical stock count is never a daily activity, and offering
 * it in the admin UI would only invite a mistake. Everything the operation
 * actually runs is expressible here.
 */
export const INVENTORY_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'semiannual'] as const;
export type InventoryFrequency = (typeof INVENTORY_FREQUENCIES)[number];

/* ---------------------------- schedule config ---------------------------- */

/**
 * Stored as JSONB and validated before it can reach the database, mirroring
 * how task schedules work.
 *
 * The one genuine difference from the task engine: `monthly` carries a LIST of
 * rules. Colectivo Comestibles is counted twice a month — the second Thursday
 * AND the last Thursday — which a single-rule monthly config cannot express.
 * Every other frequency has one date per period.
 */
export const inventoryScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('weekly'),
    weekday: weekdaySchema,
  }),
  z.object({
    kind: z.literal('biweekly'),
    /** Every occurrence is anchorDate + 14n. Required — never inferred. */
    anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    kind: z.literal('monthly'),
    /** One or more dates per month. Two for Colectivo Comestibles. */
    rules: z.array(monthlyRuleSchema).min(1).max(4),
  }),
  z.object({
    kind: z.literal('semiannual'),
    /** Exactly two dates, one per half-year. 30 June and 31 December. */
    dates: z.tuple([monthDaySchema, monthDaySchema]),
  }),
]);
export type InventorySchedule = z.infer<typeof inventoryScheduleSchema>;

export const SCHEDULE_KIND_FOR_FREQUENCY: Record<InventoryFrequency, InventorySchedule['kind']> = {
  weekly: 'weekly',
  biweekly: 'biweekly',
  monthly: 'monthly',
  semiannual: 'semiannual',
};

/* -------------------------------- defaults ------------------------------- */

/** Chosen with the operation, not inferred from the workbook. */
export const DEFAULT_WEEKLY_INVENTORY_WEEKDAY = 5; // Friday
export const LAST_THURSDAY: MonthlyRule = { type: 'nthWeekday', nth: -1, weekday: 4 };
export const SECOND_THURSDAY: MonthlyRule = { type: 'nthWeekday', nth: 2, weekday: 4 };
export const SEMIANNUAL_CLOSE_DATES: [MonthDay, MonthDay] = [
  { month: 6, day: 30 },
  { month: 12, day: 31 },
];

/* ------------------------------ generation ------------------------------- */

/** One inventory the schedule says must exist, before it is persisted. */
export interface PlannedInventory {
  inventoryDate: BusinessDate;
  /** Human-readable period label, e.g. `2026-W37`, `2026-09#2`, `2026-H2`. */
  periodKey: string;
  /** ISO calendar week — the "KW" the operation refers to inventories by. */
  isoWeek: number;
  isoYear: number;
}

/** Why a template cannot currently generate inventories. */
export interface InventoryScheduleProblem {
  code: 'missing_config' | 'kind_mismatch' | 'invalid_config';
  message: string;
}

/* -------------------------- the editing deadline ------------------------- */

/**
 * Assigned users may edit until 18:00 on the day of the inventory, after which
 * they become read-only and only an admin (or a user holding an explicit
 * temporary grant) can change anything.
 *
 * The same constant is duplicated in SQL, where it is actually enforced. This
 * copy exists so the UI can grey out controls and show a countdown — it is
 * never the boundary.
 */
export const USER_EDIT_DEADLINE_HOUR = 18;
