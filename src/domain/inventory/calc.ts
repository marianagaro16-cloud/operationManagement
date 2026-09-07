import { DateTime } from 'luxon';
import { BUSINESS_TZ, parseBusinessDate, type BusinessDate } from '@/lib/datetime';
import { USER_EDIT_DEADLINE_HOUR, type InventoryStatus } from './types';

/**
 * Inventory arithmetic and state rules.
 *
 * Pure functions with no I/O. Every rule here is ALSO enforced in SQL — these
 * copies exist so the UI can show the right number and disable the right
 * control without a round trip. The database is the boundary; this is the
 * mirror. Where the two could drift, the SQL wins.
 */

/* ------------------------------ stock ------------------------------ */

export interface QuantityRecord {
  /** Null means "not counted yet", which is not the same as counted zero. */
  quantity: number | null;
}

/**
 * Physical Stock is ALWAYS the sum of the underlying quantity records and is
 * never typed in by a user. A record with no quantity contributes nothing.
 *
 *   20 -> 12.09.2026
 *   15 -> 18.09.2026
 *   30 -> 25.09.2026   =>   Physical Stock 65
 */
export function physicalStock(records: readonly QuantityRecord[]): number {
  return records.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
}

export type CountState = 'uncounted' | 'none' | 'counted';

/**
 * Has this line been counted, and did the count find anything?
 *
 * Physical Stock alone cannot answer that. An item nobody has looked at sums
 * to 0, and so does an item somebody checked and found empty — the screen
 * showed "Physical Stock 0" for both, which are very different statements to
 * make about a warehouse.
 *
 * The database has always drawn the distinction (`quantity int check (quantity
 * is null or quantity >= 0)`, with the column comment "NULL = not counted,
 * which is not the same as 0"). This reads it back out:
 *
 *   no records, or every record still blank  -> 'uncounted'
 *   something was recorded, and it totals 0  -> 'none'      ("checked, empty")
 *   anything else                            -> 'counted'
 *
 * A blank row that someone added and never filled in stays 'uncounted' on
 * purpose: creating a row is not a statement about stock.
 */
export function countState(records: readonly QuantityRecord[]): CountState {
  const recorded = records.filter((r) => r.quantity !== null);
  if (recorded.length === 0) return 'uncounted';
  return physicalStock(recorded) === 0 ? 'none' : 'counted';
}

/**
 * Difference = Physical Stock - Inventory Digital.
 *
 * Null when there is nothing to compare against — either the template has
 * Inventory Digital disabled, or the admin has not entered the value yet. A
 * null difference must be rendered as "Pending", never as 0: showing a
 * difference of zero when no digital value exists is the one genuinely
 * misleading thing this screen could do.
 */
export function difference(
  stock: number,
  digitalQuantity: number | null,
  digitalEnabled: boolean,
): number | null {
  if (!digitalEnabled || digitalQuantity === null) return null;
  return stock - digitalQuantity;
}

/** True when an admin still owes this item a digital value. */
export function isDigitalPending(
  digitalEnabled: boolean,
  digitalQuantity: number | null,
): boolean {
  return digitalEnabled && digitalQuantity === null;
}

/* ----------------------------- item status ----------------------------- */

export interface ItemStateInput {
  digitalEnabled: boolean;
  digitalQuantity: number | null;
  physicalStock: number;
  /** An admin has accepted a non-zero difference and recorded why. */
  isResolved: boolean;
  /** The user has pressed "Complete Inventory" on the parent instance. */
  instanceCompleted: boolean;
}

/**
 * The four-state model, exactly as specified:
 *
 *   Difference = 0   -> Completed
 *   Difference != 0  -> To review
 *   admin resolves   -> Resolved (the difference may remain non-zero)
 *
 * A resolution is an explicit, attributed, note-bearing admin decision, so it
 * outranks the arithmetic and is not recomputed away. It is cleared only when
 * the Inventory Digital value itself changes, because the numbers the admin
 * signed off on no longer exist.
 */
export function itemStatus(input: ItemStateInput): InventoryStatus {
  if (input.isResolved) return 'resolved';

  if (!input.digitalEnabled) {
    // No reconciliation step for this template: counting it IS finishing it.
    return input.instanceCompleted ? 'completed' : 'in_progress';
  }

  // Digital enabled but not yet entered: still open, and separately flagged
  // as "Inventory Digital: Pending" rather than given a misleading status.
  if (input.digitalQuantity === null) return 'in_progress';

  return input.physicalStock - input.digitalQuantity === 0 ? 'completed' : 'to_review';
}

/* --------------------------- instance status --------------------------- */

export interface InstanceStateInput {
  completedAt: string | null;
  itemStatuses: readonly InventoryStatus[];
}

/**
 * Roll-up. An inventory is only as finished as its least finished item:
 * one item needing review holds the whole count in "To review", which is what
 * makes the overview list actionable.
 */
export function instanceStatus(input: InstanceStateInput): InventoryStatus {
  if (!input.completedAt) return 'in_progress';
  if (input.itemStatuses.some((s) => s === 'to_review')) return 'to_review';
  if (input.itemStatuses.some((s) => s === 'resolved')) return 'resolved';
  return 'completed';
}

/* ------------------------------ deadline ------------------------------ */

/**
 * The instant an assigned user loses write access: 18:00 Europe/Zurich on the
 * day of the inventory.
 *
 * Computed in the business zone rather than from a UTC offset, so it is 18:00
 * local on both sides of a daylight-saving change.
 */
export function editDeadline(inventoryDate: BusinessDate): DateTime {
  return parseBusinessDate(inventoryDate).set({
    hour: USER_EDIT_DEADLINE_HOUR,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

export function isPastEditDeadline(inventoryDate: BusinessDate, now: Date = new Date()): boolean {
  return DateTime.fromJSDate(now, { zone: BUSINESS_TZ }) > editDeadline(inventoryDate);
}

/** Minutes left before the deadline; 0 once it has passed. Drives the countdown. */
export function minutesUntilDeadline(
  inventoryDate: BusinessDate,
  now: Date = new Date(),
): number {
  const diff = editDeadline(inventoryDate).diff(
    DateTime.fromJSDate(now, { zone: BUSINESS_TZ }),
    'minutes',
  ).minutes;
  return Math.max(0, Math.floor(diff));
}

/* ----------------------------- validation ----------------------------- */

export type QuantityError = 'not_an_integer' | 'negative' | null;

/**
 * Physical counts are whole units. Decimals are rejected rather than rounded,
 * because a "0.5" in a count of boxes means the counter meant something the
 * system cannot represent, and silently turning it into 0 or 1 would put a
 * wrong number into an audited record.
 *
 * Null is valid: a quantity is optional, and an uncounted record is not the
 * same as a record counted as zero. Zero itself is explicitly allowed.
 */
export function validateQuantity(value: number | null): QuantityError {
  if (value === null) return null;
  if (!Number.isFinite(value) || !Number.isInteger(value)) return 'not_an_integer';
  if (value < 0) return 'negative';
  return null;
}

/**
 * Parse what a user typed into a quantity field.
 *
 * An empty field is null (not counted). Anything that is not a whole,
 * non-negative number is an error the caller must surface — never a guess.
 */
export function parseQuantityInput(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: NonNullable<QuantityError> } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };

  // Reject "1.0" and "1,5" before Number() quietly accepts one of them.
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, error: trimmed.startsWith('-') ? 'negative' : 'not_an_integer' };
  }
  const value = Number(trimmed);
  const error = validateQuantity(value);
  return error ? { ok: false, error } : { ok: true, value };
}
