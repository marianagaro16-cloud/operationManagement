/**
 * Text matching for the searchable selectors.
 *
 * Extracted from the component so the behaviour the users actually care
 * about — "cated" finding "La Catedral", "0073" finding a product code — is
 * unit-tested rather than asserted in a code review.
 */

/**
 * Case- and accent-insensitive form.
 *
 * The catalogue is full of diacritics ("Ø06cm", "Wülflingen", "El Catrín")
 * and nobody types them on a warehouse tablet.
 */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    // Combining marks left behind by NFD decomposition.
    .replace(/[̀-ͯ]/g, '')
    // Ø does not decompose, so map the stroked forms explicitly.
    .replace(/[øØ]/g, 'o')
    .replace(/[đĐ]/g, 'd')
    .replace(/[ł]/g, 'l')
    .toLowerCase();
}

/**
 * Does `haystack` match every term in `query`?
 *
 * Terms are ANDed, so typing more words narrows the list — "tortilla 1kg"
 * finds the 1 kg tortilla rather than everything containing either word.
 * Order does not matter, which is what people expect when they half-remember
 * a name.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true; // empty query matches everything, so the list browses
  const folded = fold(haystack);
  return q.split(/\s+/).every((term) => folded.includes(term));
}

/** Filter a list by a query over caller-chosen searchable text. */
export function filterByQuery<T>(
  items: T[],
  query: string,
  getSearchText: (item: T) => string,
): T[] {
  if (!query.trim()) return items;
  return items.filter((item) => matchesQuery(getSearchText(item), query));
}
