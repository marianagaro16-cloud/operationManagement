import { describe, it, expect } from 'vitest';
import { groupLinesByBrand } from './picking';

/** A line carrying only what the grouping reads. */
const line = (id: string, brandId: string | null, name?: string, sortOrder = 10) => ({
  id,
  product: {
    brand_id: brandId,
    brand: brandId ? { name: name ?? brandId, sort_order: sortOrder } : null,
  },
});

describe('grouping a picking list by brand', () => {
  it('gathers lines of one brand together', () => {
    const groups = groupLinesByBrand([
      line('a', 'b1', 'Masamor', 10),
      line('b', 'b2', 'Del Barrio', 20),
      line('c', 'b1', 'Masamor', 10),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('Masamor');
    expect(groups[0].lines.map((l) => l.id)).toEqual(['a', 'c']);
  });

  // The Brands screen sets sort_order; this file must not have an opinion of
  // its own about which brand is picked first.
  it('follows the brands own sort order, not the order lines were typed in', () => {
    const groups = groupLinesByBrand([
      line('a', 'b3', 'Colectivo Comestibles', 30),
      line('b', 'b1', 'Masamor', 10),
      line('c', 'b2', 'Del Barrio', 20),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Masamor', 'Del Barrio', 'Colectivo Comestibles']);
  });

  it('preserves the incoming order within a group, so position still decides', () => {
    const groups = groupLinesByBrand([
      line('third', 'b1'),
      line('first', 'b1'),
      line('second', 'b1'),
    ]);
    expect(groups[0].lines.map((l) => l.id)).toEqual(['third', 'first', 'second']);
  });

  // Not a brand — the absence of one. In the middle it would read as a shelf.
  it('puts unclassified products last however the brands are ordered', () => {
    const groups = groupLinesByBrand([
      line('a', null),
      line('b', 'b9', 'Zzz Last Alphabetically', 99),
    ]);
    expect(groups.map((g) => g.brandId)).toEqual(['b9', null]);
    expect(groups[1].name).toBeNull();
  });

  it('keeps one group when every product shares a brand', () => {
    const groups = groupLinesByBrand([line('a', 'b1', 'Masamor'), line('b', 'b1', 'Masamor')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(2);
  });

  it('handles an empty order', () => {
    expect(groupLinesByBrand([])).toEqual([]);
  });

  // A brand_id with no embedded brand row still groups; it just has no name
  // for the heading, which the caller renders as unclassified wording.
  it('groups by id even when the brand was not joined in', () => {
    const groups = groupLinesByBrand([
      { id: 'a', product: { brand_id: 'b1', brand: null } },
      { id: 'b', product: { brand_id: 'b1' } },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].brandId).toBe('b1');
    expect(groups[0].name).toBeNull();
  });
});
