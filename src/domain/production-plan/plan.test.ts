import { describe, expect, it } from 'vitest';
import { bestBefore, groupProducts, planLot, planTotals, rowsFromOrders, type LineFactors, type PlanProduct } from './plan';

const bio: LineFactors = {
  pure_share: 1, waste: 0.25, masa_per_grain_kg: 1.8078, sack_kg: 22.68, totopo_factor: 1.5,
  evaporation: null, flour_factor: null, water_factor: null, salt_factor: null,
};
const chip: LineFactors = {
  pure_share: 0.5, waste: 0.252, masa_per_grain_kg: 1.7, sack_kg: 22.71, totopo_factor: 1.3,
  evaporation: 0.168, flour_factor: 0.24, water_factor: 0.29, salt_factor: 0.0015,
};

const p = (id: string, section: PlanProduct['section'], weight: number | null, group = 'G', sort = 10): PlanProduct => ({
  product_id: id, section, group_label: group, best_before_days: 30, sort_order: sort, weight_kg: weight,
});

describe('planTotals', () => {
  it('adds the Bio plan up like the Excel', () => {
    // 360 × 1 kg tortillas + 300 × 1 kg → 660 kg tortilla; masa pura 660 × 1.25 = 825.
    const products = [p('a', 'tortilla', 1), p('b', 'tortilla', 1), p('m', 'masa', 3)];
    const t = planTotals(products, [{ quantities: { a: 360 } }, { quantities: { b: 300, m: 1 } }], bio);
    expect(t.kg.tortilla).toBe(660);
    expect(t.masaPura).toBe(828);
    expect(t.grainKg).toBeCloseTo(828 / 1.8078, 1);
    expect(t.sacks).toBe(Math.ceil(828 / 1.8078 / 22.68));
    expect(t.mixed).toBeNull();
  });

  it('works out the flour mix on Tortillas para freír', () => {
    const t = planTotals([p('a', 'tortilla', 1)], [{ quantities: { a: 440 } }], chip);
    expect(t.masaPura).toBeCloseTo(440 * 0.5 * 1.252, 2);
    expect(t.mixed?.masa).toBeCloseTo(440 * 1.168, 2);
    expect(t.mixed?.flour).toBeCloseTo(440 * 1.168 * 0.24, 2);
    expect(t.mixed?.water).toBeCloseTo(440 * 1.168 * 0.29, 2);
  });

  it('keeps totopos out of the masa, as tortillas to fry', () => {
    const t = planTotals([p('t', 'totopo', 6), p('s', 'tostada', 0.25)], [{ quantities: { t: 28, s: 4 } }], bio);
    expect(t.masaPura).toBe(0);
    expect(t.tortillasForTotopos).toBe((168 + 1) * 1.5);
  });

  it('names products without a weight instead of guessing', () => {
    const t = planTotals([p('x', 'tortilla', null)], [{ quantities: { x: 5 } }], bio);
    expect(t.units.x).toBe(5);
    expect(t.missingWeight).toEqual(['x']);
    expect(t.kg.tortilla).toBe(0);
  });
});

describe('lot and best-before', () => {
  it('writes the lot as day of the year and year', () => {
    expect(planLot('2026-10-21')).toBe('294-2026');
    expect(planLot('2026-01-01')).toBe('001-2026');
  });
  it('adds the days to the production day', () => {
    expect(bestBefore('2026-10-21', 45)).toBe('2026-12-05');
    expect(bestBefore('2026-10-21', null)).toBeNull();
  });
});

describe('groupProducts', () => {
  it('groups by section and heading in order', () => {
    const out = groupProducts([p('b', 'tortilla', 1, '12cm', 20), p('a', 'tortilla', 1, '14cm', 10), p('m', 'masa', 1, 'Masa', 5)]);
    expect(out.map((s) => s.section)).toEqual(['tortilla', 'masa']);
    expect(out[0].groups.map((g) => g.label)).toEqual(['14cm', '12cm']);
  });
});

describe('rowsFromOrders', () => {
  it('makes one row per customer and day with the line\'s products only', () => {
    const rows = rowsFromOrders(
      [
        { id: 'o1', customer_id: 'c1', delivery_date: '2026-10-23', delivery_note: 'Palomo', lines: [{ product_id: 'a', quantity: 5 }, { product_id: 'zz', quantity: 3 }] },
        { id: 'o2', customer_id: 'c1', delivery_date: '2026-10-23', delivery_note: 'Palomo', lines: [{ product_id: 'a', quantity: 2 }] },
        { id: 'o3', customer_id: 'c2', delivery_date: '2026-10-22', delivery_note: null, lines: [{ product_id: 'zz', quantity: 1 }] },
        { id: 'o4', customer_id: 'c3', delivery_date: '2026-10-22', delivery_note: null, lines: [{ product_id: 'a', quantity: 1 }] },
      ],
      new Set(['a']),
      new Set(['o4']),
    );
    expect(rows).toEqual([{ customer_id: 'c1', delivery_date: '2026-10-23', delivery_note: 'Palomo', order_ids: ['o1', 'o2'], quantities: { a: 7 } }]);
  });
});
