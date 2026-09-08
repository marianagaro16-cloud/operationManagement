import { describe, it, expect } from 'vitest';
import { buildMatchIndex, matchProduct, type MatchableProduct, type ProductAlias } from './matching';

/**
 * Product matching, tested against the real shape of the Product Master.
 *
 * Names and codes are taken from the actual catalogue — the same strings the
 * search tests use — because the failure that matters is not "a fuzzy matcher
 * scored 0.82", it is "the 6 cm tortilla went out instead of the 14 cm one".
 */

const p = (
  id: string,
  code: string | null,
  name: string,
  extra: Partial<MatchableProduct> = {},
): MatchableProduct => ({
  id,
  code,
  name,
  family: name,
  presentation: '—',
  is_active: true,
  ...extra,
});

const PRODUCTS: MatchableProduct[] = [
  p('t06', '0073', 'Bio Mais Tortillas 1kg - Ø06cm'),
  p('t14a', '0004', 'Bio Mais Tortillas 0.25 kg - Ø14cm'),
  p('t14b', '0002', 'Bio Mais Tortillas 1kg - Ø14cm'),
  p('t14c', '0036', 'Bio Mais Tortillas "El Catrín" 0.5 kg - Ø14cm'),
  p('ach', '0299', 'Achiote - Lol-Tun - 100g'),
  p('pan1', '0150', 'Panela Goya - Bloque - 454g'),
  p('pan2', '0151', 'Panela Goya - Molida - 1kg'),
  p('oax', '0200', 'Queso Oaxaca - 1kg'),
  p('tot', '0250', 'Totopos de Maíz - 6kg'),
  p('old', null, 'Legacy item', { name: null, family: 'Salsa Verde', presentation: '500gr' }),
  p('gone', '0999', 'Discontinued Tortillas 1kg - Ø14cm', { is_active: false }),
];

const index = (aliases: ProductAlias[] = [], customerId: string | null = 'cust-1') =>
  buildMatchIndex(PRODUCTS, aliases, customerId);

const match = (text: string, aliases?: ProductAlias[], customerId?: string | null) =>
  matchProduct(text, index(aliases, customerId === undefined ? 'cust-1' : customerId));

describe('the ladder: exact product code', () => {
  it('matches a bare code', () => {
    const r = match('0073');
    expect(r.status).toBe('matched');
    expect(r.productId).toBe('t06');
    expect(r.reason).toBe('code');
  });

  it('matches a code embedded in the cell text', () => {
    expect(match('0002 Bio Mais Tortillas').productId).toBe('t14b');
  });

  it('does not treat a short word as a code', () => {
    // "1kg" contains a digit but is a presentation, not a code, and no
    // product carries it as one.
    expect(match('1kg').status).not.toBe('matched');
  });
});

describe('the ladder: exact name', () => {
  it('matches the master name verbatim', () => {
    const r = match('Queso Oaxaca - 1kg');
    expect(r.productId).toBe('oax');
    expect(r.reason).toBe('name');
  });

  it('matches ignoring case and accents', () => {
    expect(match('QUESO OAXACA - 1KG').productId).toBe('oax');
    expect(match('bio mais tortillas "el catrin" 0.5 kg - o14cm').productId).toBe('t14c');
  });
});

describe('the ladder: configured aliases', () => {
  const ALIAS: ProductAlias[] = [
    { product_id: 'tot', customer_id: null, alias: 'Totopos' },
    { product_id: 'pan1', customer_id: 'cust-1', alias: 'panela' },
    { product_id: 'pan2', customer_id: 'cust-2', alias: 'panela' },
  ];

  it('resolves a global alias', () => {
    const r = match('Totopos', ALIAS);
    expect(r.productId).toBe('tot');
    expect(r.reason).toBe('alias');
  });

  it('a customer alias resolves the ambiguity that customer has', () => {
    // "panela" alone matches two products by name; the alias settles it.
    expect(match('panela', ALIAS, 'cust-1').productId).toBe('pan1');
  });

  it('another customer gets THEIR product, not the first one configured', () => {
    expect(match('panela', ALIAS, 'cust-2').productId).toBe('pan2');
  });

  it('a customer with no alias is still asked', () => {
    expect(match('panela', ALIAS, 'cust-3').status).toBe('ambiguous');
  });

  it('the customer alias wins over a global one', () => {
    const both: ProductAlias[] = [
      { product_id: 'pan2', customer_id: null, alias: 'panela' },
      { product_id: 'pan1', customer_id: 'cust-1', alias: 'panela' },
    ];
    expect(match('panela', both, 'cust-1').productId).toBe('pan1');
  });
});

describe('the ladder: formatting differences', () => {
  it('matches across punctuation and word order in the presentation — the spec example', () => {
    // Customer: "Bio Mais Tortillas 14cm 2kg" against a master name carrying
    // extra words. Only ONE product may survive, or a person is asked.
    const r = match('Bio Mais Tortillas 1kg 14cm');
    expect(r.status).toBe('matched');
    expect(r.productId).toBe('t14b');
  });

  it('tolerates extra spaces and stray punctuation', () => {
    expect(match('  Achiote  --  Lol Tun ,  100g ').productId).toBe('ach');
  });

  it('matches a legacy product through its family and presentation', () => {
    expect(match('Salsa Verde 500gr').productId).toBe('old');
  });
});

describe('size and diameter decide, and never silently', () => {
  it('"tortillas 14cm" does not become the 6 cm tortilla', () => {
    const r = match('tortillas 14cm');
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.map((c) => c.productId)).not.toContain('t06');
  });

  it('"tortillas 1kg 14cm" narrows to exactly one', () => {
    // "tortillas" alone leaves four standing; the two measures settle it.
    const r = match('tortillas 1kg 14cm');
    expect(r.status).toBe('matched');
    expect(r.productId).toBe('t14b');
    expect(r.reason).toBe('partial_size');
  });

  it('notation does not matter: "0.25kg" finds a master that writes "0.25 kg"', () => {
    // The failure this rung exists to prevent — a correct product rejected
    // over a space between the number and its unit.
    expect(match('Bio Mais Tortillas 0.25kg Ø14cm').productId).toBe('t14a');
    expect(match('Bio Mais Tortillas 0.25 kg Ø14cm').productId).toBe('t14a');
  });

  it('size breaks a tie the words alone cannot', () => {
    // "tortillas bio mais 0.5" is in all four names as words; only the 0.5 kg
    // one carries the measure, and that is what decides it.
    const r = match('Bio Mais Tortillas 0.5 kg');
    expect(r.status).toBe('matched');
    expect(r.productId).toBe('t14c');
    expect(r.reason).toBe('partial_size');
  });

  it('"tortillas 06cm" finds the 6 cm one', () => {
    expect(match('tortillas 1kg 06cm').productId).toBe('t06');
  });
});

describe('ambiguity is a question, never a guess', () => {
  it('"6 panela" style text offers both panelas', () => {
    const r = match('panela');
    expect(r.status).toBe('ambiguous');
    expect(r.productId).toBeNull();
    expect(r.candidates.map((c) => c.productId).sort()).toEqual(['pan1', 'pan2']);
  });

  it('offers candidates so the user can choose rather than retype', () => {
    expect(match('tortillas').candidates.length).toBeGreaterThan(1);
  });
});

describe('what is never matched', () => {
  it('unknown text produces no product and no candidates', () => {
    const r = match('bicicleta de montaña');
    expect(r.status).toBe('unknown');
    expect(r.productId).toBeNull();
    expect(r.candidates).toEqual([]);
  });

  it('empty text matches nothing', () => {
    expect(match('   ').status).toBe('unknown');
  });

  it('an INACTIVE product is never proposed', () => {
    // It would only be rejected by the save; offering it wastes the user's
    // time and looks like a bug rather than a rule.
    const r = match('Discontinued Tortillas 1kg - Ø14cm');
    expect(r.candidates.map((c) => c.productId)).not.toContain('gone');
    expect(r.productId).not.toBe('gone');
  });

  it('an alias pointing at an inactive product is ignored', () => {
    const r = match('discontinued', [{ product_id: 'gone', customer_id: null, alias: 'discontinued' }]);
    expect(r.productId).not.toBe('gone');
  });

  it('never invents a product id', () => {
    const ids = new Set(PRODUCTS.map((x) => x.id));
    for (const text of ['xyz', 'panela', 'tortillas', '0073', '']) {
      const r = matchProduct(text, index());
      if (r.productId) expect(ids.has(r.productId)).toBe(true);
      for (const c of r.candidates) expect(ids.has(c.productId)).toBe(true);
    }
  });
});
