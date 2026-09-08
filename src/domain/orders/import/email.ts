import { fold } from '@/lib/search';
import type { DetectedUnit } from './packaging';

/**
 * Deterministic extraction of order lines from pasted email text.
 *
 * NOT a natural-language model, and deliberately not one. It applies a small
 * number of rules that hold across the four languages this operation actually
 * receives orders in, and it declines everything else rather than producing a
 * plausible-looking line nobody checked. Every result goes to the preview and
 * needs a human before it becomes an order, so the failure mode of "found
 * nothing" costs a few seconds of typing while the failure mode of "found the
 * wrong thing convincingly" costs a delivery.
 *
 * THE CENTRAL RULE: a line becomes an order line only if it contains a
 * QUANTITY. "Hi Mariana," has no number and is skipped. "for Wednesday we
 * need:" has no number and is skipped. Signatures, phone numbers and dates
 * are handled by the same rule plus the exclusions below, without a list of
 * greetings in four languages that would go stale the first time somebody
 * wrote "Buenos días" instead of "Hola".
 *
 * Supported: English, German, Spanish, French — for the vocabulary of
 * quantities and packaging only. Product names are matched against the
 * Product Master, which is language-neutral because it is a list of real
 * products.
 */

export interface ParsedLine {
  /** The line exactly as the customer wrote it. */
  raw: string;
  /** The part of it that names a product, with quantity and unit removed. */
  productText: string;
  quantity: number;
  unit: DetectedUnit;
  /** The unit word the customer used, for the preview to quote back. */
  unitWord: string | null;
}

/* ------------------------------ vocabulary ------------------------------ */
/*
 * Folded (accent-free, lowercase) forms, because that is what the matcher
 * compares against. Kept as flat lists rather than per-language maps: an
 * email may mix languages — a Swiss customer writing German with "pcs" in it
 * is routine — and nothing here needs to know which language won.
 */

const UNIT_WORDS: Record<Exclude<DetectedUnit, 'unknown'>, string[]> = {
  // A count of individual items. Identical in effect to `package` here.
  unit: [
    'unit', 'units', 'pc', 'pcs', 'piece', 'pieces', 'ea', 'each',
    'stuck', 'stk', 'stck', 'stuk', 'einheit', 'einheiten',
    'unidad', 'unidades', 'ud', 'uds', 'pieza', 'piezas',
    'unite', 'unites', 'piece', 'pieces', 'pce', 'pces',
  ],
  // A package of the presentation — which is exactly what a quantity counts.
  package: [
    'package', 'packages', 'pack', 'packs', 'bag', 'bags', 'pouch', 'pouches',
    'packung', 'packungen', 'pack', 'beutel', 'tute', 'tuten', 'sack', 'sacke',
    'paquete', 'paquetes', 'bolsa', 'bolsas', 'funda', 'fundas',
    'paquet', 'paquets', 'sachet', 'sachets', 'poche', 'poches',
  ],
  // A shipping container holding some number of those packages.
  box: [
    'box', 'boxes', 'carton', 'cartons', 'case', 'cases', 'crate', 'crates',
    'karton', 'kartons', 'kiste', 'kisten', 'schachtel', 'schachteln', 'kasten',
    'caja', 'cajas', 'cartones', 'carton', 'cajon', 'cajones',
    'caisse', 'caisses', 'boite', 'boites', 'cageot', 'cageots',
  ],
  // An amount by weight or volume, which is never convertible here.
  weight: [
    'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramm',
    'kilogramme', 'kilogrammes', 'kilogramo', 'kilogramos',
    'g', 'gr', 'gram', 'grams', 'gramm', 'gramme', 'grammes', 'gramo', 'gramos',
    'l', 'lt', 'liter', 'liters', 'litre', 'litres', 'litro', 'litros',
    'ml',
  ],
};

const UNIT_LOOKUP = new Map<string, { unit: DetectedUnit; word: string }>();
for (const [unit, words] of Object.entries(UNIT_WORDS)) {
  for (const w of words) {
    // First definition wins, so 'piece' stays a unit rather than being
    // reclassified by its French spelling further down the list.
    if (!UNIT_LOOKUP.has(w)) UNIT_LOOKUP.set(w, { unit: unit as DetectedUnit, word: w });
  }
}

/**
 * Words joining a quantity to its product: "3 boxes OF totopos".
 * Dropped from the product text so the matcher never sees them.
 */
const CONNECTORS = new Set([
  'of', 'de', 'del', 'des', 'du', 'd', 'da', 'von', 'vom', 'a',
  // The multiplier in "Tortillas 14cm x 10", once the 10 has been taken.
  'x',
]);

/**
 * Words that make the number before them a SIZE, never a quantity.
 *
 * "Tortillas 14 cm" written with a space would otherwise be read as an order
 * for fourteen. Weight words are absent on purpose: "10 kg" genuinely might
 * be an order for ten kilos, so it becomes a quantity that needs confirming
 * rather than one that is discarded.
 */
const SIZE_WORDS = new Set([
  'cm', 'mm', 'centimeter', 'centimeters', 'centimetre', 'centimetres',
  'zentimeter', 'centimetro', 'centimetros', 'diameter', 'durchmesser',
  'diametro', 'diametre', 'o', // folded Ø
]);

/** Bullets and list markers a mail client leaves at the start of a line. */
const BULLET_RE = /^\s*(?:[-–—*•·>]+|\(?\d{1,2}[.)])\s+/;

/**
 * A number that is part of a measurement rather than a count.
 *
 * "14cm" and "2kg" are the product's specification, not how many of it the
 * customer wants. Written without a space in practice; with one, the unit
 * word disambiguates it and this pattern is not needed.
 */
const GLUED_MEASURE_RE = /^\d+(?:[.,]\d+)?(?:cm|mm|kg|kgs|g|gr|ml|lt|l)$/;

/**
 * Text that is a number but is not an order quantity.
 *
 * Dates, times, phone numbers and prices. Each is a real thing that appears
 * in these emails, and each would otherwise produce a confident nonsense line.
 */
const NOT_A_QUANTITY_RE = [
  // 12/03, 12-03-2026. A slash or a dash is never a decimal separator, so
  // these are unambiguous.
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
  // 12.03.2026 — three parts, so unambiguously a date.
  /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/,
  // 12.03 — a dotted day and month, both padded to two digits. Deliberately
  // narrower than \d{1,2}: "2.5 kg" is a decimal quantity, and treating every
  // dotted pair as a date would discard it.
  /\b\d{2}\.\d{2}\b(?!\d)/,
  /\b\d{1,2}:\d{2}\b/,                              // 14:30
  /\b(?:chf|eur|usd|fr\.?|€|\$)\s*\d/i,             // CHF 40
  /\b\d+\s*(?:%|percent|prozent|por ?ciento)\b/i,   // 20%
  /\+\d[\d\s]{7,}/,                                 // +41 79 ...
];

/* -------------------------------- parsing ------------------------------- */

/**
 * Split pasted text into candidate lines.
 *
 * Newlines only. Splitting on commas as well was tried on paper and rejected:
 * "Bio Mais Tortillas 14cm, 2kg" is ONE product written with a comma, and
 * splitting it invents a second line ordering two kilograms of nothing. A
 * customer who puts two products on one line loses one of them and sees that
 * in the preview, which is the recoverable failure.
 */
function candidateLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(BULLET_RE, '').trim())
    .filter((l) => l.length > 0);
}

interface QuantityHit {
  quantity: number;
  unit: DetectedUnit;
  unitWord: string | null;
  /** Token indices consumed, so they can be removed from the product text. */
  from: number;
  to: number;
}

/**
 * Find the quantity in one line.
 *
 * Reads left to right and takes the FIRST number that is a plain count,
 * because that is where people write it in every one of these languages:
 * "10 tortillas 14cm", "10 Tortillas 14cm", "10 tortillas de 14cm",
 * "10 tortillas 14cm". The trailing forms — "Tortillas 14cm x 10" and
 * "Tortillas 14cm - 10" — are handled by the fallback below.
 */
function findQuantity(tokens: string[]): QuantityHit | null {
  for (let i = 0; i < tokens.length; i++) {
    const tok = stripPunctuation(tokens[i]);
    if (!tok) continue;

    // A glued measurement is the product's size, not a count.
    if (GLUED_MEASURE_RE.test(tok)) continue;

    // "10x" and "x10" are a count with its multiplier glued on.
    const multiplier = tok.match(/^x?(\d+(?:[.,]\d+)?)x?$/);
    if (!multiplier) continue;

    const value = Number(multiplier[1].replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) continue;

    const next = tokens[i + 1] ? stripPunctuation(tokens[i + 1]) : '';

    // "14 cm" is a diameter. The number belongs to the product, not to the
    // order, so keep looking rather than ordering fourteen of something.
    if (next && SIZE_WORDS.has(next)) continue;

    // A number followed by a measurement unit is an amount, not a count of
    // packages: "10 kg" is a weight and must be confirmed, never assumed.
    const nextUnit = next ? UNIT_LOOKUP.get(next) : undefined;

    if (nextUnit) {
      return { quantity: value, unit: nextUnit.unit, unitWord: next, from: i, to: i + 1 };
    }

    // A bare number preceding a product name. "Ø14" cannot reach here
    // because the diameter symbol is not a token boundary.
    return { quantity: value, unit: 'unknown', unitWord: null, from: i, to: i };
  }
  return null;
}

function stripPunctuation(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Parse one line, or return null if it does not describe an order line.
 */
export function parseLine(raw: string): ParsedLine | null {
  const line = raw.trim();
  if (!line) return null;

  // A line with no digit at all cannot carry a quantity. This is what makes
  // greetings, sign-offs and "for Wednesday we need:" cost nothing.
  if (!/\d/.test(line)) return null;

  // Dates, times, prices and phone numbers are numbers that are not orders.
  if (NOT_A_QUANTITY_RE.some((re) => re.test(line))) return null;

  // Fold for the vocabulary lookup, but keep the original for display and for
  // product matching — the Product Master has its own folding.
  const originalTokens = line.split(/\s+/);
  const foldedTokens = originalTokens.map((t) => fold(t));

  const hit = findQuantity(foldedTokens);
  if (!hit) return null;

  // Everything that is not the quantity is a candidate product name.
  const rest = originalTokens
    .filter((_, i) => i < hit.from || i > hit.to)
    .filter((tok) => !CONNECTORS.has(fold(stripPunctuation(tok))))
    .join(' ')
    // Leading separators left behind by removing the quantity: "- tortillas".
    .replace(/^[\s\-–—:,.x×]+/i, '')
    .replace(/[\s\-–—:,.]+$/, '')
    .trim();

  // A quantity with nothing to order is not an order line. This is the case
  // that drops "2026" out of a signature and "40" out of a bare total.
  if (!/\p{L}/u.test(rest)) return null;

  return {
    raw: line,
    productText: rest,
    quantity: hit.quantity,
    unit: hit.unit,
    unitWord: hit.unitWord,
  };
}

/**
 * Extract every order line from a pasted email.
 *
 * Order is preserved — the customer's own ordering is meaningful to them and
 * makes the preview checkable against the email side by side.
 */
export function parseOrderText(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of candidateLines(text)) {
    const parsed = parseLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}
