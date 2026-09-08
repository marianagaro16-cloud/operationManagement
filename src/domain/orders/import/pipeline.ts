import { buildMatchIndex, matchProduct, type MatchIndex, type MatchReason, type MatchStatus } from './matching';
import { resolveQuantity, type DetectedUnit, type QuantityIssue } from './packaging';
import type { MatchableProduct, ProductAlias } from './matching';

/**
 * The one path from "customer text" to "a line the user can confirm".
 *
 * An Excel row and an emailed sentence differ only in where the text came
 * from. Past that point they are the same problem — resolve a product,
 * resolve a quantity into order units, decide whether a person has to look —
 * so they share this, and the preview screen is genuinely the same screen
 * rather than two that look alike and diverge on the third bug.
 *
 * Nothing here writes anything. It produces a PROPOSAL; the order is created
 * by the existing saveOrder path, from lines a person confirmed.
 */

/** Product data the pipeline needs, beyond what matching needs. */
export interface PipelineProduct extends MatchableProduct {
  /** NULL means no reliable box conversion exists. Never defaulted. */
  units_per_box: number | null;
}

export interface SourceRow {
  /** Verbatim customer text, kept for the preview and for `source_text`. */
  sourceText: string;
  /** The part that names a product. Equal to sourceText for Excel rows. */
  productText: string;
  quantity: number;
  unit: DetectedUnit;
  /** 1-based spreadsheet row, when the source was a file. */
  rowNumber?: number;
  /** The customer's own note for this line. */
  note: string | null;
}

/**
 * The traffic light the preview shows.
 *
 *   ready   — matched to one product with a quantity in units. Imports as-is.
 *   review  — something needs a person: an ambiguous product, or boxes with
 *             no conversion. Offers what it found; imports nothing until told.
 *   unknown — no product could be identified. The user picks one, or drops
 *             the line. A product is NEVER created from here.
 */
export type LineState = 'ready' | 'review' | 'unknown';

export interface PreviewLine {
  /** Stable within one preview, so React keys and edits survive re-renders. */
  key: string;
  sourceText: string;
  rowNumber?: number;

  /** Resolved product, or null while it still needs a person. */
  productId: string | null;
  matchStatus: MatchStatus;
  matchReason: MatchReason | null;
  /** What to offer when the match is ambiguous. */
  candidates: { productId: string; reason: MatchReason }[];

  /**
   * As the customer expressed it. Never overwritten, so the preview can keep
   * showing "customer wrote: 3 boxes" beside the units a person then typed —
   * losing that is losing the only thing they have to check against.
   */
  rawQuantity: number;
  unit: DetectedUnit;
  /** In ORDER UNITS. Null while it needs confirming. */
  quantity: number | null;
  quantityIssue: QuantityIssue | null;
  /** The conversion that was applied, so the preview can show its working. */
  unitsPerBox: number | null;
  /**
   * A person has stated the quantity in units.
   *
   * Once they have, no conversion may run again: re-deriving 36 from "3
   * boxes" after somebody typed 30 would silently discard their correction,
   * and choosing a product is exactly when that re-derivation would happen.
   */
  quantityConfirmed: boolean;

  note: string | null;
}

export function lineState(line: PreviewLine): LineState {
  if (line.matchStatus === 'unknown' && !line.productId) return 'unknown';
  if (!line.productId) return 'review';
  if (line.quantity === null || !(line.quantity > 0)) return 'review';
  return 'ready';
}

/** Only lines a person can act on without further input are importable. */
export function isImportable(line: PreviewLine): boolean {
  return lineState(line) === 'ready';
}

export interface PreviewSummary {
  total: number;
  ready: number;
  review: number;
  unknown: number;
}

export function summarize(lines: PreviewLine[]): PreviewSummary {
  let ready = 0, review = 0, unknown = 0;
  for (const l of lines) {
    const s = lineState(l);
    if (s === 'ready') ready++;
    else if (s === 'review') review++;
    else unknown++;
  }
  return { total: lines.length, ready, review, unknown };
}

/**
 * Run the rows through matching and quantity resolution.
 *
 * The match index is built once for the whole batch rather than per row —
 * twenty lines against a few hundred products is otherwise six thousand
 * comparisons per rung of the ladder.
 */
export function buildPreview(
  rows: SourceRow[],
  products: PipelineProduct[],
  aliases: ProductAlias[],
  customerId: string | null,
): PreviewLine[] {
  const index = buildMatchIndex(products, aliases, customerId);
  const byId = new Map(products.map((p) => [p.id, p]));
  return rows.map((row, i) => buildLine(row, i, index, byId));
}

function buildLine(
  row: SourceRow,
  i: number,
  index: MatchIndex,
  byId: Map<string, PipelineProduct>,
): PreviewLine {
  const match = matchProduct(row.productText, index);
  const productId = match.status === 'matched' ? match.productId : null;

  // The conversion depends on the product, so a line with no product yet
  // cannot have its boxes resolved — and says so, rather than falling back to
  // treating boxes as units.
  const product = productId ? byId.get(productId) ?? null : null;
  const resolved =
    row.unit === 'box' && !product
      ? { status: 'needs_confirmation' as const, units: null, issue: 'no_product' as const, unitsPerBox: null }
      : resolveQuantity({
          quantity: row.quantity,
          unit: row.unit,
          unitsPerBox: product?.units_per_box ?? null,
        });

  return {
    key: `l${i}`,
    sourceText: row.sourceText,
    rowNumber: row.rowNumber,
    productId,
    matchStatus: match.status,
    matchReason: match.reason,
    candidates: match.candidates,
    rawQuantity: row.quantity,
    unit: row.unit,
    quantity: resolved.units,
    quantityIssue: resolved.issue,
    unitsPerBox: resolved.unitsPerBox,
    quantityConfirmed: false,
    note: row.note,
  };
}

/**
 * Re-resolve one line after the user has chosen a product.
 *
 * Choosing the product is what makes a box conversion possible, so the
 * quantity has to be recomputed rather than left as the question it was when
 * nothing was selected. Picking a product for "3 boxes" either fills in 36 or
 * asks for a number — and which of those it is depends entirely on the
 * product just chosen.
 */
export function withProduct(
  line: PreviewLine,
  productId: string | null,
  products: PipelineProduct[],
): PreviewLine {
  const product = productId ? products.find((p) => p.id === productId) ?? null : null;

  // A quantity a person has already stated in units is theirs, not the
  // machine's, and picking a product does not reopen it.
  const resolved = line.quantityConfirmed
    ? { units: line.quantity, issue: line.quantityIssue, unitsPerBox: line.unitsPerBox }
    : line.unit === 'box' && !product
      ? { units: null, issue: 'no_product' as const, unitsPerBox: null }
      : resolveQuantity({
          quantity: line.rawQuantity,
          unit: line.unit,
          unitsPerBox: product?.units_per_box ?? null,
        });

  return {
    ...line,
    productId,
    // A hand-picked product is a decision, not a match. Saying "matched
    // automatically" about a choice the user made would misreport who is
    // responsible for it.
    matchStatus: productId ? 'matched' : line.matchStatus,
    matchReason: productId ? null : line.matchReason,
    quantity: resolved.units,
    quantityIssue: resolved.issue,
    unitsPerBox: resolved.unitsPerBox,
  };
}

/**
 * Set the quantity in units by hand — the answer to "please confirm the
 * quantity in units".
 *
 * `rawQuantity` and `unit` are deliberately left alone. They are the record
 * of what the CUSTOMER wrote, and the preview keeps showing it — a person
 * checking "3 boxes" against the 30 they typed needs both on screen, and
 * overwriting the first with the second removes the only thing there is to
 * check against.
 */
export function withQuantity(line: PreviewLine, units: number): PreviewLine {
  const ok = Number.isFinite(units) && units > 0;
  return {
    ...line,
    quantity: ok ? Math.round(units * 1000) / 1000 : null,
    quantityIssue: ok ? null : 'not_positive',
    // The conversion no longer applies, so its working is no longer shown.
    unitsPerBox: null,
    quantityConfirmed: true,
  };
}
