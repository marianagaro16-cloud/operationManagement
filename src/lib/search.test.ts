import { describe, it, expect } from 'vitest';
import { fold, matchesQuery, filterByQuery } from './search';

/** The real strings from the customer and product masters. */
const CUSTOMERS = [
  { company_name: '5 Almas AG', addition: 'La Catedral' },
  { company_name: '5 Atlantis AG', addition: 'Five' },
  { company_name: '7 Estrellas GmbH', addition: 'Badi Wülflingen' },
  { company_name: '7Peaks Brasserie Sarl', addition: '' },
  { company_name: 'Käsers-Schloss AG', addition: '' },
  { company_name: 'À la Demi-Lune Sàrl', addition: '' },
];
const customerText = (c: (typeof CUSTOMERS)[number]) => `${c.company_name} ${c.addition}`;

const PRODUCTS = [
  { code: '0073', name: 'Bio Mais Tortillas 1kg - Ø06cm' },
  { code: '0004', name: 'Bio Mais Tortillas 0.25 kg - Ø14cm' },
  { code: '0002', name: 'Bio Mais Tortillas 1kg - Ø14cm' },
  { code: '0036', name: 'Bio Mais Tortillas "El Catrín" 0.5 kg - Ø14cm' },
  { code: '0299', name: 'Achiote - Lol-Tun - 100g' },
];
const productText = (p: (typeof PRODUCTS)[number]) => `${p.code} ${p.name}`;

describe('fold', () => {
  it('lowercases', () => {
    expect(fold('La Catedral')).toBe('la catedral');
  });

  it('strips accents', () => {
    expect(fold('Wülflingen')).toBe('wulflingen');
    expect(fold('El Catrín')).toBe('el catrin');
    expect(fold('Käsers-Schloss')).toBe('kasers-schloss');
    expect(fold('À la Demi-Lune Sàrl')).toBe('a la demi-lune sarl');
  });

  it('handles the stroked O in diameters', () => {
    // Ø does not decompose under NFD, so it needs explicit mapping.
    expect(fold('Ø06cm')).toBe('o06cm');
    expect(fold('Ø14cm')).toBe('o14cm');
  });
});

describe('customer search — the cases from the spec', () => {
  const find = (q: string) => filterByQuery(CUSTOMERS, q, customerText).map((c) => c.company_name);

  it('"cated" finds La Catedral via the ADDITION, not the company name', () => {
    expect(find('cated')).toEqual(['5 Almas AG']);
  });

  it('"5 almas" finds 5 Almas AG', () => {
    expect(find('5 almas')).toEqual(['5 Almas AG']);
  });

  it('"badi" finds Badi Wülflingen', () => {
    expect(find('badi')).toEqual(['7 Estrellas GmbH']);
  });

  it('is case-insensitive', () => {
    expect(find('CATEDRAL')).toEqual(find('catedral'));
    expect(find('LA cAtEdRaL')).toEqual(['5 Almas AG']);
  });

  it('matches without typing the accent', () => {
    expect(find('wulflingen')).toEqual(['7 Estrellas GmbH']);
    expect(find('kasers')).toEqual(['Käsers-Schloss AG']);
  });

  it('still matches when the accent IS typed', () => {
    expect(find('Wülflingen')).toEqual(['7 Estrellas GmbH']);
  });

  it('narrows as more terms are typed', () => {
    expect(find('5').length).toBe(2);          // 5 Almas, 5 Atlantis
    expect(find('5 atlantis')).toEqual(['5 Atlantis AG']);
  });

  it('ignores term order', () => {
    expect(find('catedral almas')).toEqual(['5 Almas AG']);
    expect(find('almas catedral')).toEqual(['5 Almas AG']);
  });

  it('returns nothing for a genuine miss', () => {
    expect(find('zzzz nothing')).toEqual([]);
  });

  it('an empty query returns the whole list, so it can be browsed', () => {
    expect(filterByQuery(CUSTOMERS, '', customerText)).toHaveLength(CUSTOMERS.length);
    expect(filterByQuery(CUSTOMERS, '   ', customerText)).toHaveLength(CUSTOMERS.length);
  });
});

describe('product search — the cases from the spec', () => {
  const find = (q: string) => filterByQuery(PRODUCTS, q, productText).map((p) => p.code);

  it('"tortilla" finds the tortilla products', () => {
    expect(find('tortilla')).toEqual(['0073', '0004', '0002', '0036']);
  });

  it('"0073" finds that product code', () => {
    expect(find('0073')).toEqual(['0073']);
  });

  it('"1kg" finds products with 1kg in the name', () => {
    expect(find('1kg')).toEqual(['0073', '0002']);
  });

  it('"tortilla 1kg" narrows further', () => {
    expect(find('tortilla 1kg')).toEqual(['0073', '0002']);
  });

  it('searches the diameter without the stroked O', () => {
    expect(find('o14cm')).toEqual(['0004', '0002', '0036']);
    expect(find('o06cm')).toEqual(['0073']);
  });

  it('finds a product by an accented word typed plainly', () => {
    expect(find('catrin')).toEqual(['0036']);
  });

  it('combines code and name terms', () => {
    expect(find('0002 tortilla')).toEqual(['0002']);
  });

  it('returns nothing when no product matches', () => {
    expect(find('bicicleta')).toEqual([]);
  });
});

describe('matchesQuery', () => {
  it('matches a partial word anywhere in the text', () => {
    expect(matchesQuery('Bio Mais Tortillas 1kg', 'mais')).toBe(true);
    expect(matchesQuery('Bio Mais Tortillas 1kg', 'ortilla')).toBe(true);
  });

  it('requires every term', () => {
    expect(matchesQuery('Bio Mais Tortillas', 'bio tortillas')).toBe(true);
    expect(matchesQuery('Bio Mais Tortillas', 'bio queso')).toBe(false);
  });
});
