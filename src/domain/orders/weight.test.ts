import { describe, it, expect } from 'vitest';
import { formatKg, orderWeight, suggestNetWeightKg } from './weight';

describe('suggestNetWeightKg', () => {
  it('reads kilos and grams, with a dot or a comma', () => {
    expect(suggestNetWeightKg('Tortillas 12cm BIO', '1.75kg Fresco')).toBe(1.75);
    expect(suggestNetWeightKg('Masa Bio', '1Kg Vac')).toBe(1);
    expect(suggestNetWeightKg('Guajillo Del Barrio 100g')).toBe(0.1);
    expect(suggestNetWeightKg('Salsa Chipotle Herdez 210gr')).toBe(0.21);
    expect(suggestNetWeightKg('Mexikanischer Oregano Terana - 400 g', '—')).toBe(0.4);
    expect(suggestNetWeightKg('Tortillas p/Chips', '1.25 kg/ 10cm Fresco.')).toBe(1.25);
    expect(suggestNetWeightKg('Queso 0,5 kg')).toBe(0.5);
  });

  it('takes a box weight as the weight of what is ordered', () => {
    expect(suggestNetWeightKg('Totopo Mixto"5"', 'Caja 6kg SIN Sal')).toBe(6);
  });

  it('counts volumes at 1 L = 1 kg', () => {
    expect(suggestNetWeightKg('Jarritos Mango 370ml')).toBe(0.37);
    expect(suggestNetWeightKg('Mezcal Espadín - Bruxo No. 1 - 70cl')).toBe(0.7);
    expect(suggestNetWeightKg('Tequila Blanco "Arsenal" - 1L')).toBe(1);
    expect(suggestNetWeightKg('Karton Buen Vato - Tequila Blanco 5 Liter', 'Buen Vato Blanco 5litros')).toBe(5);
  });

  it('ignores sizes, piece counts and codes that are not weights', () => {
    expect(suggestNetWeightKg('Tostadas', '14cm-30pcs')).toBeNull();
    expect(suggestNetWeightKg('Huarachin BIO', '10 pcs Vac')).toBeNull();
    expect(suggestNetWeightKg('Tatemados congelados', 'Chile Poblano Entero 40stk')).toBeNull();
    expect(suggestNetWeightKg('Varios', 'Hojas de Maíz')).toBeNull();
    expect(suggestNetWeightKg('Totopos Azules "5"')).toBeNull();
  });

  it('does not read a weight out of the middle of a word or number', () => {
    expect(suggestNetWeightKg('Model G2 Glass')).toBeNull();
    expect(suggestNetWeightKg('Bio Blaue Mais Tortilla 0.5 kg - Ø14cm')).toBe(0.5);
  });

  it('refuses when the name is not clear', () => {
    // Two different measures.
    expect(suggestNetWeightKg('Chips 150g', 'Caja 3kg')).toBeNull();
    // A multipack: the unit ordered is the pack, not one can.
    expect(suggestNetWeightKg('Cerveza 6x330ml')).toBeNull();
    expect(suggestNetWeightKg('Cerveza 24 x 33cl')).toBeNull();
    expect(suggestNetWeightKg(null, undefined, '')).toBeNull();
  });

  it('is not confused by the same measure written twice', () => {
    expect(suggestNetWeightKg('Maíz Blanco 220g', 'Maíz Blanco Mexicano 220 g')).toBe(0.22);
  });
});

describe('orderWeight', () => {
  it('multiplies each ordered quantity by its product weight', () => {
    expect(orderWeight([
      { ordered_quantity: 9, product: { net_weight_kg: 1.75 } },
      { ordered_quantity: '4', product: { net_weight_kg: '0.37' } },
    ])).toEqual({ kg: 17.23, linesWithoutWeight: 0 });
  });

  it('keeps a partial total and counts the lines it could not weigh', () => {
    expect(orderWeight([
      { ordered_quantity: 2, product: { net_weight_kg: 6 } },
      { ordered_quantity: 3, product: { net_weight_kg: null } },
      { ordered_quantity: 1, product: null },
    ])).toEqual({ kg: 12, linesWithoutWeight: 2 });
  });

  it('ignores lines with nothing ordered', () => {
    expect(orderWeight([
      { ordered_quantity: 0, product: { net_weight_kg: null } },
      { ordered_quantity: null, product: { net_weight_kg: 5 } },
    ])).toEqual({ kg: 0, linesWithoutWeight: 0 });
  });
});

describe('formatKg', () => {
  it('shows kg with one decimal', () => {
    expect(formatKg(48.53)).toBe('48.5 kg');
    expect(formatKg(0.37)).toBe('0.4 kg');
    expect(formatKg(12)).toBe('12.0 kg');
  });
});
