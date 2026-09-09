/**
 * How a picking list is laid out.
 *
 * Pure and free of I/O, like the progress rules next door, so the order a
 * person walks the shelves in is unit-tested rather than re-derived inside a
 * component.
 *
 * The order LINES arrive sorted by position — the sequence somebody typed
 * them in, which is arbitrary as far as the warehouse is concerned. Our own
 * brands are stocked together, so grouping by brand turns one walk per line
 * into one walk per brand without changing a single quantity.
 */

/** The least a line has to carry to be grouped. */
export interface BrandedLine {
  product: {
    brand_id: string | null;
    brand?: { name: string; sort_order: number } | null;
  };
}

export interface BrandGroup<L> {
  /** Null for products nobody has classified yet. */
  brandId: string | null;
  /** The brand's name, or null for that same unclassified group. */
  name: string | null;
  lines: L[];
}

/**
 * Order lines gathered under their brand.
 *
 * Groups follow the brands' own `sort_order`, which is what the Brands screen
 * exists to set, so the sequence is the operation's decision and not this
 * file's. Unclassified products always come LAST regardless of it: they are
 * not a brand, they are the absence of one, and putting them in the middle
 * would read as though "no brand" were a shelf.
 *
 * Within a group the incoming order is preserved, so position still decides
 * and nothing is silently resequenced beyond the grouping itself.
 */
export function groupLinesByBrand<L extends BrandedLine>(lines: L[]): BrandGroup<L>[] {
  const groups = new Map<string, BrandGroup<L> & { sort: number }>();

  for (const line of lines) {
    const key = line.product.brand_id ?? '__none__';
    let group = groups.get(key);
    if (!group) {
      group = {
        brandId: line.product.brand_id,
        name: line.product.brand?.name ?? null,
        sort: line.product.brand_id
          ? line.product.brand?.sort_order ?? 0
          : Number.MAX_SAFE_INTEGER,
        lines: [],
      };
      groups.set(key, group);
    }
    group.lines.push(line);
  }

  return [...groups.values()]
    .sort((a, b) => a.sort - b.sort || (a.name ?? '').localeCompare(b.name ?? ''))
    .map(({ sort: _sort, ...group }) => group);
}
