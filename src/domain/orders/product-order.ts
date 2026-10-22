import type { Product } from '@/types/orders';

/**
 * Blue corn sells far less than everything else, so the product pickers for
 * orders list it after the rest: typing "14cm" offers the yellow tortillas
 * before the blue ones (2026-10-22).
 *
 * Blue corn is whatever sits in a "Blue …" category — Blue tortilla, Blue
 * tostadas, Blue fried tortilla, Blue totopos, Blue masa — so a new blue
 * product follows the rule as soon as it is classified.
 */
export function isBlueCorn(p: Pick<Product, 'category_info'>): boolean {
  return /^blue\b/i.test(p.category_info?.name?.trim() ?? '');
}

/** The same list with blue corn moved to the end; each half keeps its order. */
export function blueCornLast<T extends Pick<Product, 'category_info'>>(products: T[]): T[] {
  return [...products.filter((p) => !isBlueCorn(p)), ...products.filter(isBlueCorn)];
}
