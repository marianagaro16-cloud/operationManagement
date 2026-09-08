import { describe, it, expect } from 'vitest';
import { boxesRequired, resolveQuantity } from './packaging';

/**
 * Packaging conversion.
 *
 * These tests exist because the failure mode is invisible: a wrong conversion
 * produces a confident preview, a plausible order and the wrong quantity of
 * real food at a real restaurant. Every branch that could produce a number
 * from nothing is asserted to produce a question instead.
 */

describe('units pass through untouched', () => {
  it('a plain count is the order quantity', () => {
    expect(resolveQuantity({ quantity: 20, unit: 'unit', unitsPerBox: null }))
      .toMatchObject({ status: 'ok', units: 20 });
  });

  it('a count with no unit word is a count', () => {
    expect(resolveQuantity({ quantity: 6, unit: 'unknown', unitsPerBox: null }))
      .toMatchObject({ status: 'ok', units: 6 });
  });

  it('a package IS the order unit, so no conversion is involved', () => {
    // The order quantity already counts packages of the presentation, so this
    // is an identity, not an invented factor.
    expect(resolveQuantity({ quantity: 5, unit: 'package', unitsPerBox: 12 }))
      .toMatchObject({ status: 'ok', units: 5, unitsPerBox: null });
  });
});

describe('boxes convert ONLY where the master says how', () => {
  it('3 boxes at 12 to a box is 36 units — the spec example', () => {
    expect(resolveQuantity({ quantity: 3, unit: 'box', unitsPerBox: 12 }))
      .toMatchObject({ status: 'ok', units: 36, unitsPerBox: 12 });
  });

  it('3 boxes with NO conversion asks, and produces no number', () => {
    const r = resolveQuantity({ quantity: 3, unit: 'box', unitsPerBox: null });
    expect(r.status).toBe('needs_confirmation');
    expect(r.issue).toBe('no_conversion');
    expect(r.units).toBeNull();
  });

  it('never falls back to a house rule when the master is silent', () => {
    for (const missing of [null, undefined, 0, -1, Number.NaN]) {
      const r = resolveQuantity({ quantity: 3, unit: 'box', unitsPerBox: missing as number | null });
      expect(r.units).toBeNull();
      expect(r.status).toBe('needs_confirmation');
    }
  });

  it('a fractional conversion still rounds to the column scale', () => {
    expect(resolveQuantity({ quantity: 2, unit: 'box', unitsPerBox: 2.5 }))
      .toMatchObject({ status: 'ok', units: 5 });
  });
});

describe('weight is never converted', () => {
  it('kilograms always ask, however much the master knows', () => {
    const r = resolveQuantity({ quantity: 10, unit: 'weight', unitsPerBox: 12 });
    expect(r.status).toBe('needs_confirmation');
    expect(r.issue).toBe('weight_unit');
    expect(r.units).toBeNull();
  });
});

describe('invalid quantities are refused, not coerced', () => {
  it.each([0, -1, -0.5])('%s is not an order quantity', (q) => {
    const r = resolveQuantity({ quantity: q, unit: 'unit', unitsPerBox: null });
    expect(r.status).toBe('invalid');
    expect(r.issue).toBe('not_positive');
    expect(r.units).toBeNull();
  });

  it('a non-number is refused rather than becoming zero', () => {
    const r = resolveQuantity({ quantity: Number.NaN, unit: 'unit', unitsPerBox: null });
    expect(r.status).toBe('invalid');
    expect(r.issue).toBe('not_a_number');
  });
});

describe('order quantity and box count stay separate — the spec example', () => {
  it('14 units at 6 per box is an order of 14 and a pick of 3 boxes', () => {
    const resolved = resolveQuantity({ quantity: 14, unit: 'unit', unitsPerBox: 6 });
    // The order says 14. It must never say 3.
    expect(resolved.units).toBe(14);
    expect(boxesRequired(14, 6)).toBe(3);
  });

  it('boxes required rounds UP, because a part box is still a box', () => {
    expect(boxesRequired(13, 6)).toBe(3);
    expect(boxesRequired(12, 6)).toBe(2);
    expect(boxesRequired(1, 6)).toBe(1);
  });

  it('says nothing rather than zero when the master cannot say', () => {
    expect(boxesRequired(14, null)).toBeNull();
    expect(boxesRequired(14, 0)).toBeNull();
    expect(boxesRequired(0, 6)).toBeNull();
  });
});
