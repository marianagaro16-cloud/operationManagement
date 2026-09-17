/**
 * Net weight: reading a suggestion out of a product's name, and adding up an
 * order.
 *
 * A product's weight is the NET weight of one unit as it is ordered — one
 * package of "1.75kg Fresco" is 1.75 kg; a product sold as "Caja 6kg" is 6 kg.
 * It is stored on the product (`products.net_weight_kg`) and entered by a
 * person; what lives here only SUGGESTS one from the name, and only when the
 * name says it unambiguously.
 *
 * Volumes count as weight at 1 L = 1 kg. That is an approximation, which is
 * why every suggestion is marked for review until somebody confirms it.
 */

/** One weight or volume written in a product's text, e.g. "1.75kg", "370 ml", "5 Liter". */
const MEASURE = /(?<![\w.,])(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|ml|cl|l|lt|liter|litros?|litres?)(?![\p{L}\d])/giu;

/** "6x330ml", "6 x 33cl": a multipack, where the unit ordered is not the measure written. */
const MULTIPACK = /\d+\s*[x×]\s*\d+(?:[.,]\d+)?\s*(kg|g|grs?|ml|cl|l)(?![\p{L}\d])/iu;

const TO_KG: Record<string, number> = {
  kg: 1, kilo: 1, kilos: 1,
  g: 0.001, gr: 0.001, grs: 0.001,
  ml: 0.001, cl: 0.01,
  l: 1, lt: 1, liter: 1, litro: 1, litros: 1, litre: 1, litres: 1,
};

/**
 * The weight a product's texts clearly state, in kg, or null.
 *
 * Null whenever it is not clear: nothing written, a multipack, or two
 * different measures (e.g. "500g" in the name and "1kg" in the presentation).
 * The same measure written twice is not a conflict.
 */
export function suggestNetWeightKg(...texts: (string | null | undefined)[]): number | null {
  const text = texts.filter(Boolean).join(' · ');
  if (!text || MULTIPACK.test(text)) return null;

  const found = new Set<number>();
  for (const m of text.matchAll(MEASURE)) {
    const value = Number(m[1].replace(',', '.'));
    const factor = TO_KG[m[2].toLowerCase()];
    if (!Number.isFinite(value) || value <= 0 || factor === undefined) continue;
    found.add(roundKg(value * factor));
  }

  return found.size === 1 ? [...found][0] : null;
}

/** Grams precision: enough for a 5 g sachet, no floating-point tails. */
export function roundKg(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}

export interface WeighableLine {
  ordered_quantity: number | string | null;
  product: { net_weight_kg: number | string | null } | null;
}

export interface OrderWeight {
  /** Sum over the lines whose product has a weight. */
  kg: number;
  /** Lines left out of that sum because their product has no weight yet. */
  linesWithoutWeight: number;
}

/** Net weight of an order on its ORDERED quantities. */
export function orderWeight(lines: WeighableLine[]): OrderWeight {
  let kg = 0;
  let linesWithoutWeight = 0;
  for (const line of lines) {
    const qty = Number(line.ordered_quantity ?? 0);
    if (!(qty > 0)) continue;
    const weight = line.product?.net_weight_kg;
    if (weight === null || weight === undefined || weight === '') {
      linesWithoutWeight++;
      continue;
    }
    kg += qty * Number(weight);
  }
  return { kg: roundKg(kg), linesWithoutWeight };
}

/** How a weight is shown everywhere: kg with one decimal, e.g. "48.5 kg". */
export function formatKg(kg: number): string {
  return `${kg.toFixed(1)} kg`;
}
