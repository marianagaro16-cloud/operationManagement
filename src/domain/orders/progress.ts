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
  /** A reason is recorded — a code, or free text written before codes existed. */
  explained: boolean;
  /**
   * Nothing more to do on this line: fully allocated, over, or short — even
   * wholly unsent — with a reason.
   */
  accounted: boolean;
  /** Left out on purpose: nothing allocated, and a reason says why. */
  notSent: boolean;
}

/** What a line carries about its shortfall. */
export interface ShortfallLike {
  shortfall_code?: string | null;
  shortfall_reason?: string | null;
}

export function isShortfallExplained(shortfall: ShortfallLike | null | undefined): boolean {
  return Boolean(shortfall?.shortfall_code) || Boolean(shortfall?.shortfall_reason?.trim());
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
  shortfall?: ShortfallLike | null,
): LineProgress {
  const ordered = round3(toQuantity(orderedQuantity));
  const allocated = allocatedQuantity(allocations);
  const diff = round3(ordered - allocated);

  const status: LineStatus =
    allocated === 0 ? 'not_prepared'
      : diff > 0 ? 'partial'
        : diff === 0 ? 'complete'
          : 'over_allocated';

  const explained = isShortfallExplained(shortfall);

  return {
    ordered,
    allocated,
    remaining: Math.max(0, diff),
    overBy: Math.max(0, -diff),
    status,
    // Only a started line demands a reason: an untouched line is simply not
    // prepared yet. It MAY be given one, though — that is how a product with
    // no stock at all is left out of the order.
    needsReason: status === 'partial' && !explained,
    explained,
    accounted: status === 'complete' || status === 'over_allocated' || explained,
    notSent: status === 'not_prepared' && explained,
  };
}

export interface OrderProgress {
  lines: number;
  complete: number;
  partial: number;
  notPrepared: number;
  overAllocated: number;
  /** Every line fully allocated, exactly. */
  isComplete: boolean;
  /**
   * Every line accounted for — fully allocated, over-allocated, or short WITH
   * a reason, a wholly unsent line included — and at least one lot recorded.
   * What decides whether an order can be marked Ready — the same rule as
   * order_is_prepared() in SQL and the preparation report. An explained
   * shortfall is a finished preparation; isComplete alone would leave it
   * looking unfinished for ever. An order with every product left out is not:
   * nothing would leave.
   */
  isPrepared: boolean;
  /** Work has started but is not finished. */
  isPartial: boolean;
  /** At least one short line still lacks an explanation. */
  hasUnexplainedShortfall: boolean;
}

export function orderProgress(
  lines: ({ ordered_quantity: unknown; allocations: AllocationLike[] } & ShortfallLike)[],
): OrderProgress {
  let complete = 0, partial = 0, notPrepared = 0, overAllocated = 0, unexplained = 0, accounted = 0;
  let anyAllocated = false;

  for (const line of lines) {
    const p = lineProgress(line.ordered_quantity, line.allocations, line);
    if (p.allocated > 0) anyAllocated = true;
    if (p.status === 'complete') complete++;
    else if (p.status === 'partial') partial++;
    else if (p.status === 'over_allocated') overAllocated++;
    else notPrepared++;
    if (p.needsReason) unexplained++;
    if (p.accounted) accounted++;
  }

  const total = lines.length;
  return {
    lines: total,
    complete,
    partial,
    notPrepared,
    overAllocated,
    isComplete: total > 0 && complete === total,
    isPrepared: total > 0 && accounted === total && anyAllocated,
    isPartial: total > 0 && complete !== total && notPrepared !== total,
    hasUnexplainedShortfall: unexplained > 0,
  };
}

/**
 * Would this allocation exceed what was ordered?
 *
 * Mirrors the database trigger exactly so the UI can block early with a clear
 * message — but the database is what actually enforces it. A role holding
 * orders.manage is permitted to exceed, because correcting a real-world
 * miscount is a management responsibility.
 */
export function canAllocate(
  orderedQuantity: unknown,
  existingAllocations: AllocationLike[],
  newQuantity: unknown,
  canOverAllocate: boolean,
  /** When editing, the allocation being replaced is excluded from the total. */
  excludeQuantity = 0,
): { ok: true } | { ok: false; reason: 'over_allocation' | 'invalid_quantity'; available: number } {
  const qty = toQuantity(newQuantity);
  if (!(qty > 0)) return { ok: false, reason: 'invalid_quantity', available: 0 };

  const ordered = toQuantity(orderedQuantity);
  const already = round3(allocatedQuantity(existingAllocations) - toQuantity(excludeQuantity));
  const available = round3(ordered - already);

  if (canOverAllocate) return { ok: true };
  if (round3(already + qty) > ordered) {
    return { ok: false, reason: 'over_allocation', available: Math.max(0, available) };
  }
  return { ok: true };
}
