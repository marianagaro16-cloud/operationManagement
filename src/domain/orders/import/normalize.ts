import { fold } from '@/lib/search';

/**
 * Text normalisation for order-request matching.
 *
 * Built on `fold()` from lib/search rather than beside it. The order form's
 * product picker and the importer must agree on what "the same text" means —
 * if "Ø14cm" folds one way for the person typing and another way for the
 * importer, a product findable by hand becomes unmatchable on import, and
 * nobody would ever guess why.
 *
 * Everything here is pure. Matching decisions that ship real food to real
 * customers are tested, not reasoned about in a review.
 */

/**
 * Comparison form: accent-folded, punctuation reduced to spaces, whitespace
 * collapsed.
 *
 * Punctuation is what separates a customer's spelling from the master's —
 * "Bio Mais Tortillas 14cm 2kg" against
 * "Bio Mais Tortillas - Fresh Pack - 2kg - Ø14cm" differ by hyphens before
 * they differ by anything meaningful. Removing it is safe because it carries
 * no product identity; removing digits or letters would not be.
 */
export function normalize(text: string): string {
  return fold(text)
    // Keep letters, digits and the decimal point. Everything else is a gap.
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    // A trailing or leading dot is punctuation, not a decimal.
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Normalised tokens, in order, with empties dropped. */
export function tokenize(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/**
 * A size or weight written in a product name: "14cm", "2kg", "0.5 kg", "500g",
 * "Ø06cm", "1.75kg", "750ml".
 *
 * Returned in a canonical form — value plus unit, no space, decimals trimmed —
 * so "0.5 kg", "0,5kg" and "500g"… no: 500g is NOT normalised to 0.5kg. Unit
 * conversion is exactly the kind of helpfulness that turns a 500 g bag into a
 * 500 g bag on one screen and half a kilo on another. Only the notation is
 * canonicalised, never the unit.
 */
export interface Measure {
  value: number;
  unit: string;
  /** Canonical text, e.g. "14cm", "0.5kg". */
  key: string;
}

const MEASURE_UNITS = ['cm', 'mm', 'kg', 'gr', 'g', 'ml', 'lt', 'l'];

// Number, optional space, then a unit that is not followed by more letters —
// so "14cm" and "0.5 kg" match while "2 grande" does not match "gr".
const MEASURE_RE = new RegExp(
  String.raw`(\d+(?:[.,]\d+)?)\s*(${MEASURE_UNITS.join('|')})(?![\p{L}])`,
  'giu',
);

export function extractMeasures(text: string): Measure[] {
  const folded = fold(text);
  const out: Measure[] = [];
  const seen = new Set<string>();

  for (const m of folded.matchAll(MEASURE_RE)) {
    const value = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    // "gr" and "g" are the same unit spelled two ways; that is notation, not
    // a conversion, so they canonicalise together.
    const unit = m[2] === 'gr' ? 'g' : m[2] === 'lt' ? 'l' : m[2];
    const key = `${trimNumber(value)}${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value, unit, key });
  }
  return out;
}

function trimNumber(n: number): string {
  return String(Number(n.toFixed(3)));
}

/**
 * The text with its sizes and weights removed.
 *
 * Sizes must not be compared as WORDS, because notation differs on the two
 * sides of every real import: a customer writes "0.25kg" and the master
 * writes "0.25 kg", or the reverse. Requiring the token to appear verbatim
 * rejects the correct product over a space.
 *
 * So the words are compared as words and the measures are compared as
 * measures, by `measuresAgree`. Splitting the two is what lets
 * "Bio Mais Tortillas 14cm 2kg" reach
 * "Bio Mais Tortillas - Fresh Pack - 2kg - Ø14cm" without any of the fuzzy
 * scoring this module refuses to do.
 */
export function stripMeasures(text: string): string {
  return fold(text).replace(MEASURE_RE, ' ');
}

/**
 * Do two texts describe the same size?
 *
 * Every measure the CUSTOMER stated must appear in the candidate. The reverse
 * is deliberately not required: a master name carries the full specification
 * ("Fresh Pack - 2kg - Ø14cm") while a customer writes the part they care
 * about ("14cm"). Requiring symmetry would reject the correct product for
 * being more precise than the request.
 *
 * A customer measure the candidate does not have is disqualifying, which is
 * the case that matters: "tortillas 14cm" must not match the 6 cm tortilla.
 */
export function measuresAgree(customerText: string, candidateText: string): boolean {
  const wanted = extractMeasures(customerText);
  if (wanted.length === 0) return true;
  const have = new Set(extractMeasures(candidateText).map((m) => m.key));
  return wanted.every((m) => have.has(m.key));
}

/** How many of the customer's stated measures the candidate carries. */
export function measureOverlap(customerText: string, candidateText: string): number {
  const have = new Set(extractMeasures(candidateText).map((m) => m.key));
  return extractMeasures(customerText).filter((m) => have.has(m.key)).length;
}

/**
 * Does the candidate contain every token of the query?
 *
 * The same ANDed-terms rule the product picker uses, so "tort 14" narrowing
 * to one product by hand and by import are the same behaviour.
 */
export function containsAllTokens(candidateText: string, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return false;
  const haystack = normalize(candidateText);
  return queryTokens.every((tok) => haystack.includes(tok));
}
