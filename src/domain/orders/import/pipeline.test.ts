import { describe, it, expect } from 'vitest';
import { parseOrderText } from './email';
import {
  buildPreview,
  isImportable,
  lineState,
  summarize,
  withProduct,
  withQuantity,
  type PipelineProduct,
  type SourceRow,
} from './pipeline';
import type { ProductAlias } from './matching';

/**
 * The whole proposal, end to end.
 *
 * This is the screen the user actually sees, expressed as data: which lines
 * are green, which are yellow, which are red, and what happens when they fix
 * one. The invariant asserted throughout is that nothing but a GREEN line is
 * importable — a preview that let a yellow line through would defeat every
 * safeguard in the modules underneath it.
 */

const P = (
  id: string,
  code: string | null,
  name: string,
  units_per_box: number | null = null,
): PipelineProduct => ({
  id, code, name, family: name, presentation: '—', is_active: true, units_per_box,
});

const PRODUCTS: PipelineProduct[] = [
  P('t14', '0002', 'Bio Mais Tortillas 1kg - Ø14cm', 10),
  P('t06', '0073', 'Bio Mais Tortillas 1kg - Ø06cm', 10),
  P('pan1', '0150', 'Panela Goya - Bloque - 454g'),
  P('pan2', '0151', 'Panela Goya - Molida - 1kg'),
  P('oax', '0200', 'Queso Oaxaca - 1kg', 12),
  P('tot', '0250', 'Totopos de Maíz - 6kg'),
];

const ALIASES: ProductAlias[] = [
  { product_id: 'tot', customer_id: null, alias: 'totopos' },
];

const preview = (rows: SourceRow[]) => buildPreview(rows, PRODUCTS, ALIASES, 'cust-1');

const fromEmail = (text: string) =>
  preview(
    parseOrderText(text).map((l) => ({
      sourceText: l.raw,
      productText: l.productText,
      quantity: l.quantity,
      unit: l.unit,
      note: null,
    })),
  );

describe('the spec email, all the way to a preview', () => {
  const lines = fromEmail(`Hi Mariana,

for Wednesday we need:
10 tortillas 1kg 14cm
4 Oaxaca 1kg
6 panela
2 boxes of totopos

Thanks!`);

  it('produces one preview line per order line in the email', () => {
    expect(lines).toHaveLength(4);
  });

  it('matches the unambiguous products and converts nothing it should not', () => {
    expect(lines[0]).toMatchObject({ productId: 't14', quantity: 10 });
    expect(lines[1]).toMatchObject({ productId: 'oax', quantity: 4 });
    expect(lineState(lines[0])).toBe('ready');
    expect(lineState(lines[1])).toBe('ready');
  });

  it('"6 panela" needs a person, because two panelas exist', () => {
    expect(lines[2].matchStatus).toBe('ambiguous');
    expect(lines[2].productId).toBeNull();
    expect(lineState(lines[2])).toBe('review');
    expect(lines[2].candidates.map((c) => c.productId).sort()).toEqual(['pan1', 'pan2']);
  });

  it('"2 boxes of totopos" resolves the product but NOT the quantity', () => {
    // The alias identifies the product; the master has no units_per_box for
    // it, so the number of units is a question and stays one.
    expect(lines[3].productId).toBe('tot');
    expect(lines[3].quantity).toBeNull();
    expect(lines[3].quantityIssue).toBe('no_conversion');
    expect(lineState(lines[3])).toBe('review');
  });

  it('counts the three states for the summary strip', () => {
    expect(summarize(lines)).toEqual({ total: 4, ready: 2, review: 2, unknown: 0 });
  });

  it('only the ready lines may be imported', () => {
    expect(lines.filter(isImportable).map((l) => l.productId)).toEqual(['t14', 'oax']);
  });
});

describe('a box conversion the master CAN answer', () => {
  it('3 boxes of a product packed 12 to a box is 36 units', () => {
    const [line] = fromEmail('3 boxes Queso Oaxaca 1kg');
    expect(line).toMatchObject({ productId: 'oax', quantity: 36, unitsPerBox: 12 });
    expect(lineState(line)).toBe('ready');
  });

  it('the raw expression is kept so the preview can show its working', () => {
    const [line] = fromEmail('3 boxes Queso Oaxaca 1kg');
    expect(line.rawQuantity).toBe(3);
    expect(line.unit).toBe('box');
  });
});

describe('unknown products', () => {
  it('are red, carry no product and offer nothing', () => {
    const [line] = fromEmail('5 bicicletas');
    expect(lineState(line)).toBe('unknown');
    expect(line.productId).toBeNull();
    expect(line.candidates).toEqual([]);
    expect(isImportable(line)).toBe(false);
  });

  it('are never turned into a new product', () => {
    const lines = fromEmail('5 bicicletas\n3 cosas raras');
    const known = new Set(PRODUCTS.map((p) => p.id));
    for (const l of lines) {
      if (l.productId) expect(known.has(l.productId)).toBe(true);
    }
  });
});

describe('the user corrects a line', () => {
  it('choosing a product settles an ambiguous line', () => {
    const [line] = fromEmail('6 panela');
    const fixed = withProduct(line, 'pan1', PRODUCTS);
    expect(fixed.productId).toBe('pan1');
    expect(fixed.quantity).toBe(6);
    expect(lineState(fixed)).toBe('ready');
  });

  it('choosing a product can also settle the box conversion', () => {
    const [line] = fromEmail('3 boxes panela');
    expect(line.quantity).toBeNull();
    // Oaxaca is 12 to a box, so picking it answers the quantity question too.
    const fixed = withProduct(line, 'oax', PRODUCTS);
    expect(fixed.quantity).toBe(36);
    expect(lineState(fixed)).toBe('ready');
  });

  it('choosing a product with no conversion leaves the question open', () => {
    const [line] = fromEmail('3 boxes panela');
    const fixed = withProduct(line, 'pan1', PRODUCTS);
    expect(fixed.quantity).toBeNull();
    expect(fixed.quantityIssue).toBe('no_conversion');
    expect(lineState(fixed)).toBe('review');
  });

  it('a hand-picked product is not reported as an automatic match', () => {
    const [line] = fromEmail('6 panela');
    expect(withProduct(line, 'pan1', PRODUCTS).matchReason).toBeNull();
  });

  it('clearing the product returns the line to needing one', () => {
    const [line] = fromEmail('10 tortillas 1kg 14cm');
    expect(lineState(withProduct(line, null, PRODUCTS))).toBe('review');
  });

  it('typing the units answers "please confirm the quantity in units"', () => {
    const [line] = fromEmail('2 boxes of totopos');
    const fixed = withQuantity(line, 25);
    expect(fixed.quantity).toBe(25);
    expect(lineState(fixed)).toBe('ready');
  });

  it('what the customer wrote survives the correction', () => {
    // The preview shows both, because "2 boxes" is what the person is
    // checking the 25 against.
    const fixed = withQuantity(fromEmail('2 boxes of totopos')[0], 25);
    expect(fixed.rawQuantity).toBe(2);
    expect(fixed.unit).toBe('box');
  });

  it('a confirmed unit quantity is never multiplied a second time', () => {
    // The line stops being "2 boxes" the moment a person says what it is in
    // units; re-resolving it must not reapply a conversion.
    const [line] = fromEmail('3 boxes Queso Oaxaca 1kg');
    const confirmed = withQuantity(line, 30);
    expect(withProduct(confirmed, 'oax', PRODUCTS).quantity).toBe(30);
  });

  it('rejects a non-positive confirmation instead of accepting it', () => {
    const [line] = fromEmail('2 boxes of totopos');
    expect(withQuantity(line, 0).quantity).toBeNull();
    expect(withQuantity(line, -5).quantity).toBeNull();
    expect(isImportable(withQuantity(line, 0))).toBe(false);
  });
});

describe('spreadsheet rows use the same pipeline', () => {
  it('an Excel row and an email line reach the same shape', () => {
    const [fromFile] = preview([
      {
        sourceText: 'Queso Oaxaca - 1kg',
        productText: 'Queso Oaxaca - 1kg',
        quantity: 4,
        unit: 'unit',
        rowNumber: 7,
        note: 'para el jueves',
      },
    ]);
    expect(fromFile).toMatchObject({
      productId: 'oax',
      quantity: 4,
      rowNumber: 7,
      note: 'para el jueves',
    });
    expect(lineState(fromFile)).toBe('ready');
  });

  it('a boxes row with no product yet asks rather than assuming units', () => {
    const [line] = preview([
      { sourceText: 'algo raro', productText: 'algo raro', quantity: 3, unit: 'box', note: null },
    ]);
    expect(line.productId).toBeNull();
    expect(line.quantity).toBeNull();
    expect(line.quantityIssue).toBe('no_product');
  });

  it('an invalid quantity cell is never coerced to a number', () => {
    const [line] = preview([
      { sourceText: 'Queso Oaxaca - 1kg', productText: 'Queso Oaxaca - 1kg', quantity: Number.NaN, unit: 'unit', note: null },
    ]);
    expect(line.quantity).toBeNull();
    expect(isImportable(line)).toBe(false);
  });
});
