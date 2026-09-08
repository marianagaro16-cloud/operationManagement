import { describe, it, expect } from 'vitest';
import { parseLine, parseOrderText } from './email';

/**
 * Email extraction.
 *
 * Every case here is an email of the kind this operation actually receives.
 * The two properties being defended are: a line with a quantity is found, and
 * a line WITHOUT one is not invented. The second matters more — an order that
 * silently gained a line is worse than one that visibly lost one, because the
 * preview shows the loss and nobody checks a gain.
 */

const lines = (text: string) =>
  parseOrderText(text).map((l) => [l.quantity, l.unit, l.productText] as const);

describe('the spec example, in English', () => {
  const EMAIL = `Hi Mariana,

for Wednesday we need:
10 tortillas 14cm
4 Oaxaca 1kg
6 panela
2 boxes of totopos 6kg

Thanks!`;

  it('finds exactly the four order lines', () => {
    expect(lines(EMAIL)).toEqual([
      [10, 'unknown', 'tortillas 14cm'],
      [4, 'unknown', 'Oaxaca 1kg'],
      [6, 'unknown', 'panela'],
      [2, 'box', 'totopos 6kg'],
    ]);
  });

  it('the greeting, the date sentence and the sign-off produce nothing', () => {
    expect(parseOrderText(EMAIL)).toHaveLength(4);
  });
});

describe('German', () => {
  it('reads a structured German order', () => {
    expect(
      lines(`Guten Tag Mariana

für Mittwoch bitte:
12 Stück Tortillas 14cm
3 Kartons Totopos
5 Packungen Panela

Freundliche Grüsse`),
    ).toEqual([
      [12, 'unit', 'Tortillas 14cm'],
      [3, 'box', 'Totopos'],
      [5, 'package', 'Panela'],
    ]);
  });

  it('handles the umlaut spellings without them being typed', () => {
    expect(lines('4 Kisten Tortillas')).toEqual([[4, 'box', 'Tortillas']]);
    expect(lines('4 Tüten Panela')).toEqual([[4, 'package', 'Panela']]);
  });
});

describe('Spanish', () => {
  it('reads an informal Spanish order', () => {
    expect(
      lines(`Hola Mariana,

para el miércoles necesitamos:
- 20 tortillas de 14cm
- 6 cajas de totopos
- 4 paquetes de panela
- 10 unidades de queso oaxaca

Gracias!`),
    ).toEqual([
      [20, 'unknown', 'tortillas 14cm'],
      [6, 'box', 'totopos'],
      [4, 'package', 'panela'],
      [10, 'unit', 'queso oaxaca'],
    ]);
  });

  it('strips the connector "de" so the matcher never sees it', () => {
    expect(lines('6 cajas de totopos')[0][2]).toBe('totopos');
  });
});

describe('French', () => {
  it('reads a French order', () => {
    expect(
      lines(`Bonjour Mariana,

pour mercredi :
15 pièces tortillas 14cm
2 cartons de totopos
3 paquets de panela

Cordialement`),
    ).toEqual([
      [15, 'unit', 'tortillas 14cm'],
      [2, 'box', 'totopos'],
      [3, 'package', 'panela'],
    ]);
  });
});

describe('quantity expressions', () => {
  it('reads a bare count', () => {
    expect(parseLine('10 tortillas')).toMatchObject({ quantity: 10, unit: 'unknown' });
  });

  it.each([
    ['10 units tortillas', 10, 'unit'],
    ['10 pcs tortillas', 10, 'unit'],
    ['10 pieces tortillas', 10, 'unit'],
    ['3 boxes tortillas', 3, 'box'],
    ['3 cartons tortillas', 3, 'box'],
    ['3 cases tortillas', 3, 'box'],
    ['5 packages tortillas', 5, 'package'],
    ['5 bags tortillas', 5, 'package'],
    ['10 kg tortillas', 10, 'weight'],
  ])('%s', (text, quantity, unit) => {
    expect(parseLine(text)).toMatchObject({ quantity, unit });
  });

  it('reads a decimal written either way', () => {
    expect(parseLine('2.5 kg queso')).toMatchObject({ quantity: 2.5 });
    expect(parseLine('2,5 kg queso')).toMatchObject({ quantity: 2.5 });
  });

  it('reads the multiplier forms', () => {
    expect(parseLine('10x tortillas')).toMatchObject({ quantity: 10, productText: 'tortillas' });
    expect(parseLine('Tortillas 14cm x 10')).toMatchObject({
      quantity: 10,
      productText: 'Tortillas 14cm',
    });
  });

  it('reads a trailing quantity after a dash', () => {
    expect(parseLine('Tortillas 14cm - 10')).toMatchObject({
      quantity: 10,
      productText: 'Tortillas 14cm',
    });
  });
});

describe('numbers that are NOT quantities', () => {
  it('a size is not a quantity — glued', () => {
    // The only number is the diameter, so there is no order line here.
    expect(parseLine('Bio Mais Tortillas 14cm')).toBeNull();
  });

  it('a size is not a quantity — written with a space', () => {
    expect(parseLine('Bio Mais Tortillas 14 cm')).toBeNull();
  });

  it('a date is not a quantity', () => {
    expect(parseLine('Lieferung am 12.03.2026')).toBeNull();
    expect(parseLine('delivery on 12/03')).toBeNull();
  });

  it('a time is not a quantity', () => {
    expect(parseLine('bitte vor 14:30 liefern')).toBeNull();
  });

  it('a price is not a quantity', () => {
    expect(parseLine('Total CHF 240.50')).toBeNull();
  });

  it('a phone number is not a quantity', () => {
    expect(parseLine('Tel +41 79 123 45 67')).toBeNull();
  });

  it('a bare number with no product is not a quantity', () => {
    expect(parseLine('2026')).toBeNull();
    expect(parseLine('40')).toBeNull();
  });

  it('a line with no digits at all is skipped', () => {
    expect(parseLine('Hi Mariana,')).toBeNull();
    expect(parseLine('for Wednesday we need:')).toBeNull();
    expect(parseLine('Vielen Dank und liebe Grüsse')).toBeNull();
  });
});

describe('formatting the customer did not think about', () => {
  it('strips bullets and list numbering', () => {
    expect(lines('- 10 tortillas\n• 4 oaxaca\n* 2 panela\n1. 6 totopos')).toEqual([
      [10, 'unknown', 'tortillas'],
      [4, 'unknown', 'oaxaca'],
      [2, 'unknown', 'panela'],
      [6, 'unknown', 'totopos'],
    ]);
  });

  it('ignores blank lines and stray whitespace', () => {
    expect(lines('\n\n   10 tortillas   \n\n')).toEqual([[10, 'unknown', 'tortillas']]);
  });

  it('keeps the customer ordering, which is how the preview is checked', () => {
    expect(lines('4 oaxaca\n10 tortillas').map((l) => l[0])).toEqual([4, 10]);
  });

  it('finds nothing in a message that orders nothing', () => {
    expect(parseOrderText('Hi Mariana, could you send me your price list? Thanks')).toEqual([]);
  });

  it('finds nothing in empty text', () => {
    expect(parseOrderText('')).toEqual([]);
    expect(parseOrderText('   \n  \n ')).toEqual([]);
  });
});

describe('the documented limitation', () => {
  it('two products on one line yield one line, visibly', () => {
    // Splitting on commas would turn "Tortillas 14cm, 2kg" into an order for
    // two kilograms of nothing. Losing the second product is the recoverable
    // failure and it is visible in the preview.
    const parsed = parseOrderText('10 tortillas, 4 oaxaca');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].quantity).toBe(10);
  });
});
