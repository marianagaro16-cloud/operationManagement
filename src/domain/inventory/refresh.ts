/**
 * Refreshing a brand inventory from the product list.
 *
 * The four brand inventories are DEFINED as "this brand's active products",
 * but the items are a stored snapshot — a product added on Tuesday does not
 * join Friday's count by itself. This computes the difference so somebody can
 * pull it in deliberately.
 *
 * Deliberately not automatic. A list that changed underneath an open count
 * would mean the sheet somebody is filling in stops matching the shelf they
 * walked, which is worse than a list refreshed on purpose.
 *
 * Pure: it decides, and the caller writes. That is what lets the rules below
 * be asserted directly rather than inferred from what the database ended up
 * looking like.
 */

/** A product as this planner needs it. */
export interface RefreshProduct {
  id: string;
  code: string | null;
  name: string | null;
  family: string;
}

/** An existing template item as this planner needs it. */
export interface RefreshItem {
  id: string;
  name: string;
  product_id: string | null;
  item_group: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface NewItem {
  name: string;
  item_group: string | null;
  product_id: string;
  sort_order: number;
}

export interface RefreshPlan {
  /** Products with no item yet. */
  insert: NewItem[];
  /** Items whose product came back: ids to set is_active = true. */
  reactivate: string[];
  /**
   * Items whose product left the brand or was deactivated. IDS ONLY — these
   * are switched off, never deleted, because a count may already reference
   * them and history outranks tidiness.
   */
  deactivate: string[];
  /** Items that stay, with the group and position the product list implies. */
  reposition: { id: string; item_group: string | null; sort_order: number }[];
  /** Items left completely alone: the hand-added ones. See below. */
  untouched: number;
}

/**
 * What an item is called on the count sheet.
 *
 * The product name, falling back to its family. A name is unique per template
 * and a catalogue can hold two products with the same one, so a repeat is
 * suffixed with its code — two rows on the shelf are two rows to count, and
 * quietly collapsing them into one would lose stock.
 */
function itemName(product: RefreshProduct, isRepeat: boolean): string {
  const base = product.name?.trim() || product.family;
  return isRepeat ? `${base} · ${product.code ?? product.id.slice(0, 8)}` : base;
}

/**
 * The order somebody walks the shelves in: by product family, then by name.
 *
 * Applied to every product-linked item, not only the new ones. A generated
 * list whose old rows kept an old order and whose new rows arrived at the
 * bottom would drift further from the shelf with every refresh.
 */
export function planTemplateRefresh(
  products: RefreshProduct[],
  items: RefreshItem[],
): RefreshPlan {
  const wanted = [...products].sort(
    (a, b) =>
      (a.family ?? '').localeCompare(b.family ?? '') ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  );

  const byProduct = new Map<string, RefreshItem>();
  for (const item of items) {
    if (item.product_id) byProduct.set(item.product_id, item);
  }

  const plan: RefreshPlan = {
    insert: [],
    reactivate: [],
    deactivate: [],
    reposition: [],
    untouched: 0,
  };

  const seenNames = new Map<string, number>();
  const keep = new Set<string>();

  wanted.forEach((product, index) => {
    const base = product.name?.trim() || product.family;
    const repeats = seenNames.get(base) ?? 0;
    seenNames.set(base, repeats + 1);

    const group = product.family?.trim() || null;
    const position = (index + 1) * 10;
    const existing = byProduct.get(product.id);

    if (!existing) {
      plan.insert.push({
        name: itemName(product, repeats > 0),
        item_group: group,
        product_id: product.id,
        sort_order: position,
      });
      return;
    }

    keep.add(existing.id);
    if (!existing.is_active) plan.reactivate.push(existing.id);
    if (existing.item_group !== group || existing.sort_order !== position) {
      plan.reposition.push({ id: existing.id, item_group: group, sort_order: position });
    }
  });

  for (const item of items) {
    /*
     * An item nobody linked to a product was added by hand — the packaging
     * rows, or something counted that the catalogue does not carry. A refresh
     * FROM PRODUCTS has no opinion about those and must not switch them off:
     * doing so would make this button quietly destructive to work it knows
     * nothing about.
     */
    if (!item.product_id) {
      plan.untouched++;
      continue;
    }
    if (!keep.has(item.id) && item.is_active) plan.deactivate.push(item.id);
  }

  return plan;
}

/** Does this plan actually change anything? Drives the "nothing to do" case. */
export function planIsEmpty(plan: RefreshPlan): boolean {
  return (
    plan.insert.length === 0 &&
    plan.reactivate.length === 0 &&
    plan.deactivate.length === 0 &&
    plan.reposition.length === 0
  );
}
