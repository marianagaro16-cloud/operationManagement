/**
 * Preparation progress.
 *
 * Pure and free of I/O, like the recurrence engine, so the rules that decide
 * "is this order ready" are unit-tested rather than re-derived in a component.
 *
 * A quantity is always a COUNT OF PACKAGES of the product's presentation.
 * Ordering 9 of "Tortillas 12cm BIO / 1.75kg Fresco" means nine 1.75 kg
 * packages. The system never converts between presentations.
 */

export type LineStatus = 'not_prepared' | 'partial' | 'complete' | 'over_allocated';

export interface AllocationLike {
  /** `unknown` because numeric(12,3) arrives from Postgres as a string. */
  quantity: unknown;
}

export interface LineProgress {
  ordered: number;
  allocated: number;
  /** Never negative; see `overBy` for the excess. */
  remaining: number;
  overBy: number;
  status: LineStatus;
  /** A short line needs an explanation before it counts as resolved. */
  needsReason: boolean;
}

/** Quantities are numeric(12,3) in Postgres and may arrive as strings. */
export function toQuantity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function allocatedQuantity(allocations: AllocationLike[]): number {
  // Round to the column's scale so repeated additions cannot drift.
  return round3(allocations.reduce((sum, a) => sum + toQuantity(a.quantity), 0));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function lineProgress(
  orderedQuantity: unknown,
  allocations: AllocationLike[],
  shortfallReason?: string | null,
): LineProgress {
  const ordered = round3(toQuantity(orderedQuantity));
  const allocated = allocatedQuantity(allocations);
  const diff = round3(ordered - allocated);

  const status: LineStatus =
    allocated === 0 ? 'not_prepared'
      : diff > 0 ? 'partial'
        : diff === 0 ? 'complete'
          : 'over_allocated';

  return {
    ordered,
    allocated,
    remaining: Math.max(0, diff),
    overBy: Math.max(0, -diff),
    status,
    // Only a genuine shortfall needs a reason, and only once work has begun:
    // an untouched line is simply not prepared yet, not a discrepancy.
    needsReason:
      status === 'partial' && !(shortfallReason && shortfallReason.trim().length > 0),
  };
}

export interface OrderProgress {
  lines: number;
  complete: number;
  partial: number;
  notPrepared: number;
  overAllocated: number;
  /** Every line fully allocated. */
  isComplete: boolean;
  /** Work has started but is not finished. */
  isPartial: boolean;
  /** At least one short line still lacks an explanation. */
  hasUnexplainedShortfall: boolean;
}

export function orderProgress(
  lines: { ordered_quantity: unknown; shortfall_reason?: string | null; allocations: AllocationLike[] }[],
): OrderProgress {
  let complete = 0, partial = 0, notPrepared = 0, overAllocated = 0, unexplained = 0;

  for (const line of lines) {
    const p = lineProgress(line.ordered_quantity, line.allocations, line.shortfall_reason);
    if (p.status === 'complete') complete++;
    else if (p.status === 'partial') partial++;
    else if (p.status === 'over_allocated') overAllocated++;
    else notPrepared++;
    if (p.needsReason) unexplained++;
  }

  const total = lines.length;
  return {
    lines: total,
    complete,
    partial,
    notPrepared,
    overAllocated,
    isComplete: total > 0 && complete === total,
    isPartial: total > 0 && complete !== total && notPrepared !== total,
    hasUnexplainedShortfall: unexplained > 0,
  };
}

/**
 * Would this allocation exceed what was ordered?
 *
 * Mirrors the database trigger exactly so the UI can block early with a clear
 * message — but the database is what actually enforces it. An admin is
 * permitted to exceed, because correcting a real-world miscount is an admin
 * responsibility.
 */
export function canAllocate(
  orderedQuantity: unknown,
  existingAllocations: AllocationLike[],
  newQuantity: unknown,
  isAdmin: boolean,
  /** When editing, the allocation being replaced is excluded from the total. */
  excludeQuantity = 0,
): { ok: true } | { ok: false; reason: 'over_allocation' | 'invalid_quantity'; available: number } {
  const qty = toQuantity(newQuantity);
  if (!(qty > 0)) return { ok: false, reason: 'invalid_quantity', available: 0 };

  const ordered = toQuantity(orderedQuantity);
  const already = round3(allocatedQuantity(existingAllocations) - toQuantity(excludeQuantity));
  const available = round3(ordered - already);

  if (isAdmin) return { ok: true };
  if (round3(already + qty) > ordered) {
    return { ok: false, reason: 'over_allocation', available: Math.max(0, available) };
  }
  return { ok: true };
}
