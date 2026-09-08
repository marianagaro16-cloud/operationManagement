import { fold } from '@/lib/search';
import {
  containsAllTokens,
  measureOverlap,
  measuresAgree,
  normalize,
  stripMeasures,
  tokenize,
} from './normalize';

/**
 * Deterministic product matching.
 *
 * The Product Master is the authority. This resolves customer text to an
 * EXISTING product id or it declines — there is no branch that creates a
 * product, invents one, or picks between two plausible ones. Ambiguity is a
 * result the user is shown, not a coin the machine flips.
 *
 * The ladder is ordered so that the confident rungs are tried first and a
 * hit on any of them stops the search. A weak rung can therefore never
 * override a strong one, which is the property that makes the outcome
 * predictable enough to trust on a warehouse tablet.
 *
 *   1. exact product code
 *   2. exact product name
 *   3. exact configured alias        (customer-scoped before global)
 *   4. normalised product name       (punctuation and accents folded away)
 *   5. strong partial: every word the customer wrote appears in the name
 *   6. among those, size and diameter decide
 *
 * Nothing weaker than that exists. There is no edit distance, no fuzzy
 * score, no "closest match" — a near miss that nobody confirmed is how the
 * wrong pallet leaves the building.
 */

/** Why a product was proposed. A stable key; the sentence lives in i18n. */
export type MatchReason =
  | 'code'
  | 'name'
  | 'alias'
  | 'normalized_name'
  | 'partial'
  | 'partial_size';

export type MatchStatus = 'matched' | 'ambiguous' | 'unknown';

export interface MatchableProduct {
  id: string;
  code: string | null;
  name: string | null;
  family: string;
  presentation: string;
  is_active: boolean;
}

export interface ProductAlias {
  product_id: string;
  /** NULL = applies to every customer. */
  customer_id: string | null;
  alias: string;
}

export interface MatchCandidate {
  productId: string;
  reason: MatchReason;
}

export interface MatchResult {
  status: MatchStatus;
  /** Set only when status is 'matched'. */
  productId: string | null;
  reason: MatchReason | null;
  /**
   * What the ladder found. One entry when matched, several when ambiguous,
   * none when unknown. Shown to the user so an ambiguous line is a choice
   * rather than a dead end.
   */
  candidates: MatchCandidate[];
}

/** Everything text-searchable about a product, as the master states it. */
function productText(p: MatchableProduct): string {
  return [p.name ?? '', p.family, p.presentation].filter(Boolean).join(' ');
}

/**
 * The display-ish name used for exact-name comparison.
 * Mirrors `productLabel()` so what a person sees is what is compared.
 */
function productName(p: MatchableProduct): string {
  if (p.name?.trim()) return p.name;
  if (p.presentation && p.presentation !== '—') return `${p.family} — ${p.presentation}`;
  return p.family;
}

/**
 * A code is only recognised where it looks like one.
 *
 * The master's codes are digit strings ("0073"). Treating any token as a
 * possible code would let the word "kg" match a product coded "kg", and would
 * let a customer's line number match a product. Requiring at least one digit
 * and three characters keeps the rule to the shape the data actually has.
 */
function looksLikeCode(token: string): boolean {
  return token.length >= 3 && /\d/.test(token);
}

/**
 * An index built once per import, not per line.
 *
 * A 20-line order request against a few hundred products is 20 × 300 string
 * comparisons per rung if built naively. Built once, each rung is a map
 * lookup and only the partial rung scans.
 */
export interface MatchIndex {
  products: MatchableProduct[];
  byCode: Map<string, MatchableProduct[]>;
  byName: Map<string, MatchableProduct[]>;
  byNormalizedName: Map<string, MatchableProduct[]>;
  /** alias -> products, for aliases scoped to the importing customer. */
  byCustomerAlias: Map<string, MatchableProduct[]>;
  /** alias -> products, for aliases that apply to everybody. */
  byGlobalAlias: Map<string, MatchableProduct[]>;
}

function push(map: Map<string, MatchableProduct[]>, key: string, p: MatchableProduct) {
  if (!key) return;
  const list = map.get(key);
  if (list) {
    // A product indexed twice under one key is still one candidate.
    if (!list.some((x) => x.id === p.id)) list.push(p);
  } else {
    map.set(key, [p]);
  }
}

/**
 * Build the index.
 *
 * `customerId` scopes the alias tables. A null customer means only global
 * aliases apply — never another customer's, whose shorthand may legitimately
 * mean a different product.
 */
export function buildMatchIndex(
  products: MatchableProduct[],
  aliases: ProductAlias[],
  customerId: string | null,
): MatchIndex {
  // Only ACTIVE products are matchable. §32: an inactive product may not be
  // put on a new order, so proposing one would only produce a line that the
  // save then rejects.
  const active = products.filter((p) => p.is_active);
  const byId = new Map(active.map((p) => [p.id, p]));

  const index: MatchIndex = {
    products: active,
    byCode: new Map(),
    byName: new Map(),
    byNormalizedName: new Map(),
    byCustomerAlias: new Map(),
    byGlobalAlias: new Map(),
  };

  for (const p of active) {
    if (p.code) push(index.byCode, fold(p.code.trim()), p);
    push(index.byName, fold(productName(p).trim()), p);
    push(index.byNormalizedName, normalize(productName(p)), p);
    // The verbatim imported name and the legacy pair are both worth an entry:
    // a legacy product has no `name` and is only reachable through the pair.
    if (p.name) push(index.byNormalizedName, normalize(p.name), p);
  }

  for (const a of aliases) {
    const product = byId.get(a.product_id);
    if (!product) continue; // alias to an inactive or deleted product
    const key = normalize(a.alias);
    if (a.customer_id === null) push(index.byGlobalAlias, key, product);
    else if (a.customer_id === customerId) push(index.byCustomerAlias, key, product);
  }

  return index;
}

function resolve(hits: MatchableProduct[] | undefined, reason: MatchReason): MatchResult | null {
  if (!hits || hits.length === 0) return null;
  if (hits.length === 1) {
    return { status: 'matched', productId: hits[0].id, reason, candidates: [{ productId: hits[0].id, reason }] };
  }
  // Two products answering to one exact key is a master-data problem, not a
  // matching problem. It is surfaced, never resolved by picking the first.
  return {
    status: 'ambiguous',
    productId: null,
    reason: null,
    candidates: hits.map((p) => ({ productId: p.id, reason })),
  };
}

/** How many candidates an ambiguous line offers before the list stops helping. */
const MAX_CANDIDATES = 8;

export function matchProduct(text: string, index: MatchIndex): MatchResult {
  const raw = text.trim();
  const unknown: MatchResult = { status: 'unknown', productId: null, reason: null, candidates: [] };
  if (!raw) return unknown;

  const foldedWhole = fold(raw);
  const tokens = tokenize(raw);

  // ---- 1. exact product code ----
  // The whole cell first — an Order Request whose product column holds "0073".
  let hit = resolve(index.byCode.get(foldedWhole), 'code');
  if (hit) return hit;

  // Then a code appearing as a word, which is how "0073 Tortillas 1kg" reads.
  for (const tok of tokens) {
    if (!looksLikeCode(tok)) continue;
    hit = resolve(index.byCode.get(tok), 'code');
    if (hit) return hit;
  }

  // ---- 2. exact product name ----
  hit = resolve(index.byName.get(foldedWhole), 'name');
  if (hit) return hit;

  // ---- 3. exact configured alias, customer's own before the shared ones ----
  const normalized = normalize(raw);
  hit = resolve(index.byCustomerAlias.get(normalized), 'alias');
  if (hit) return hit;
  hit = resolve(index.byGlobalAlias.get(normalized), 'alias');
  if (hit) return hit;

  // ---- 4. normalised name ----
  hit = resolve(index.byNormalizedName.get(normalized), 'normalized_name');
  if (hit) return hit;

  // ---- 5. strong partial: every WORD the customer wrote is in the name ----
  //
  // Measures are held back from this rung and settled by the next one, so a
  // customer's "0.25kg" is not rejected by a master that writes "0.25 kg".
  if (tokens.length === 0) return unknown;
  const words = tokenize(stripMeasures(raw));
  // A request that is nothing BUT a measure has no words to compare; fall
  // back to the raw tokens rather than matching the entire catalogue.
  const queryWords = words.length > 0 ? words : tokens;

  const partial = index.products.filter((p) =>
    containsAllTokens(words.length > 0 ? stripMeasures(productText(p)) : productText(p), queryWords),
  );
  if (partial.length === 0) return unknown;
  if (partial.length === 1) {
    return {
      status: 'matched',
      productId: partial[0].id,
      reason: 'partial',
      candidates: [{ productId: partial[0].id, reason: 'partial' }],
    };
  }

  // ---- 6. size and diameter decide between the survivors ----
  //
  // "tortillas 14cm" reaches here against every tortilla. A measure the
  // customer stated and a candidate lacks is disqualifying — which is what
  // stops the 6 cm product from being proposed for a 14 cm request.
  const sized = partial.filter((p) => measuresAgree(raw, productText(p)));
  if (sized.length === 1) {
    return {
      status: 'matched',
      productId: sized[0].id,
      reason: 'partial_size',
      candidates: [{ productId: sized[0].id, reason: 'partial_size' }],
    };
  }

  // Still more than one — or none, once size was applied. Offer the best set
  // and require a person. This is the "6 panela" case from the spec, and the
  // correct outcome for it is a question, not an answer.
  const offered = (sized.length > 0 ? sized : partial)
    .map((p) => ({ product: p, overlap: measureOverlap(raw, productText(p)) }))
    // Most specific first, so the likeliest choice is at the top of the list
    // the user is shown. Ordering a list is not choosing from it.
    .sort((a, b) => b.overlap - a.overlap || productName(a.product).localeCompare(productName(b.product)))
    .slice(0, MAX_CANDIDATES);

  return {
    status: 'ambiguous',
    productId: null,
    reason: null,
    candidates: offered.map(({ product }) => ({
      productId: product.id,
      reason: sized.length > 0 ? 'partial_size' : 'partial',
    })),
  };
}
