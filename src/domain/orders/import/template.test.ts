import { describe, it, expect } from 'vitest';
import {
  columnLetterToIndex,
  extractRows,
  identifyTemplate,
  parseQuantityCell,
  parseUnitWord,
  resolveColumn,
  rowUnit,
  type OrderRequestTemplate,
  type Sheet,
} from './template';

/**
 * Order Request template mapping, tested against literal grids.
 *
 * No fixture workbook: the rules being tested are "which row is data" and
 * "which column is quantity", and a binary file would hide both behind a
 * parser. The workbook library's only job is producing one of these grids.
 */

const template = (over: Partial<OrderRequestTemplate> = {}): OrderRequestTemplate => ({
  id: 'tpl-1',
  customer_id: 'cust-1',
  name: 'La Catedral weekly',
  sheet_name: 'Pedido',
  header_row: 3,
  first_data_row: 4,
  product_column: 'Producto',
  quantity_column: 'Cantidad',
  notes_column: null,
  unit_column: null,
  default_unit: 'unit',
  header_signature: ['Producto', 'Cantidad'],
  is_active: true,
  ...over,
});

/** A realistic customer sheet: a title block, a header row, then a catalogue. */
const SHEET: Sheet = {
  name: 'Pedido',
  rows: [
    ['ORDER REQUEST', null, null, null],
    ['La Catedral', null, null, null],
    ['Código', 'Producto', 'Cantidad', 'Comentario'],
    ['0002', 'Bio Mais Tortillas 1kg - Ø14cm', 20, 'para el jueves'],
    ['0073', 'Bio Mais Tortillas 1kg - Ø06cm', null, null],
    ['0150', 'Panela Goya - Bloque - 454g', 6, null],
    ['0200', 'Queso Oaxaca - 1kg', 0, null],
    ['0250', 'Totopos de Maíz - 6kg', 4, null],
    [null, null, null, null],
  ],
};

describe('column addressing', () => {
  it('converts spreadsheet letters', () => {
    expect(columnLetterToIndex('A')).toBe(0);
    expect(columnLetterToIndex('B')).toBe(1);
    expect(columnLetterToIndex('Z')).toBe(25);
    expect(columnLetterToIndex('AA')).toBe(26);
  });

  it('resolves a column by letter without consulting the file', () => {
    expect(resolveColumn('B', SHEET, 3)).toBe(1);
    expect(resolveColumn('b', SHEET, null)).toBe(1);
  });

  it('resolves a column by header label', () => {
    expect(resolveColumn('Producto', SHEET, 3)).toBe(1);
    expect(resolveColumn('Cantidad', SHEET, 3)).toBe(2);
  });

  it('matches a header label regardless of case and accents', () => {
    expect(resolveColumn('PRODUCTO', SHEET, 3)).toBe(1);
    expect(resolveColumn('codigo', SHEET, 3)).toBe(0);
  });

  it('accepts a header that contains the label, when only one does', () => {
    const sheet: Sheet = { name: 'S', rows: [['Producto', 'Cantidad (cajas)']] };
    expect(resolveColumn('Cantidad', sheet, 1)).toBe(1);
  });

  it('refuses when two headers contain the label', () => {
    // "Cantidad pedida" and "Cantidad confirmada" are a real shape, and
    // reading the first one silently would be the wrong number.
    const sheet: Sheet = { name: 'S', rows: [['Cantidad pedida', 'Cantidad confirmada']] };
    expect(resolveColumn('Cantidad', sheet, 1)).toBeNull();
  });

  it('cannot resolve a label with no header row', () => {
    expect(resolveColumn('Producto', SHEET, null)).toBeNull();
  });

  it('returns null for a missing column rather than guessing', () => {
    expect(resolveColumn('Precio', SHEET, 3)).toBeNull();
    expect(resolveColumn(null, SHEET, 3)).toBeNull();
  });
});

describe('identification', () => {
  it('identifies a template by its sheet and headers', () => {
    const r = identifyTemplate([SHEET], [template()]);
    expect(r.status).toBe('identified');
    if (r.status === 'identified') expect(r.template.id).toBe('tpl-1');
  });

  it('does not identify when the sheet is absent', () => {
    expect(identifyTemplate([{ ...SHEET, name: 'Sheet1' }], [template()]).status).toBe('not_found');
  });

  it('does not identify when a signature header is missing', () => {
    const sheet: Sheet = { ...SHEET, rows: SHEET.rows.map((r, i) => (i === 2 ? ['Código', 'Artikel'] : r)) };
    expect(identifyTemplate([sheet], [template()]).status).toBe('not_found');
  });

  it('ignores inactive templates', () => {
    expect(identifyTemplate([SHEET], [template({ is_active: false })]).status).toBe('not_found');
  });

  it('asks when two templates both fit, rather than picking one', () => {
    const r = identifyTemplate([SHEET], [
      template({ id: 'a', header_signature: ['Producto'] }),
      template({ id: 'b', header_signature: ['Producto', 'Cantidad'] }),
    ]);
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') {
      // Most specific offered first.
      expect(r.templates.map((t) => t.id)).toEqual(['b', 'a']);
    }
  });

  it('never consults the filename — a template with no signature still needs its sheet', () => {
    const plain = template({ header_signature: [], sheet_name: 'Bestellung' });
    expect(identifyTemplate([SHEET], [plain]).status).toBe('not_found');
  });
});

describe('extraction', () => {
  it('reads only the rows the customer actually requested', () => {
    const r = extractRows(SHEET, template());
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;

    expect(r.rows.map((x) => [x.rowNumber, x.productText, x.quantityText])).toEqual([
      [4, 'Bio Mais Tortillas 1kg - Ø14cm', '20'],
      [6, 'Panela Goya - Bloque - 454g', '6'],
      [8, 'Totopos de Maíz - 6kg', '4'],
    ]);
  });

  it('skips a catalogue row with no quantity — the customer did not order it', () => {
    const r = extractRows(SHEET, template());
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.rows.some((x) => x.productText.includes('Ø06cm'))).toBe(false);
  });

  it('skips an explicit zero, which is "not ordered" written out', () => {
    const r = extractRows(SHEET, template());
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.rows.some((x) => x.productText.includes('Oaxaca'))).toBe(false);
  });

  it('carries the customer comment through', () => {
    const r = extractRows(SHEET, template({ notes_column: 'Comentario' }));
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.rows[0].note).toBe('para el jueves');
    expect(r.rows[1].note).toBeNull();
  });

  it('keeps a quantity whose product cell is blank, so the line is not lost', () => {
    const sheet: Sheet = {
      ...SHEET,
      rows: [...SHEET.rows.slice(0, 4), ['0999', '', 7, null]],
    };
    const r = extractRows(sheet, template());
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.rows.at(-1)).toMatchObject({ productText: '', quantityText: '7' });
  });

  it('reports a missing column instead of importing the wrong one', () => {
    expect(extractRows(SHEET, template({ quantity_column: 'Menge' }))).toEqual({
      status: 'column_not_found',
      column: 'quantity',
    });
    expect(extractRows(SHEET, template({ product_column: 'Artikel' }))).toEqual({
      status: 'column_not_found',
      column: 'product',
    });
  });

  it('works on a file with no header row, addressed by letter', () => {
    const sheet: Sheet = { name: 'Sheet1', rows: [['Tortillas 1kg', 12], ['Panela', 4]] };
    const r = extractRows(
      sheet,
      template({
        sheet_name: null,
        header_row: null,
        first_data_row: 1,
        product_column: 'A',
        quantity_column: 'B',
        header_signature: [],
      }),
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.rows).toHaveLength(2);
  });
});

describe('units', () => {
  const t = template({ unit_column: 'Unidad' });
  const row = (unitText: string | null) => ({
    rowNumber: 4,
    productText: 'x',
    quantityText: '3',
    unitText,
    note: null,
  });

  it('the file wins when it states a unit', () => {
    expect(rowUnit(row('cajas'), t)).toBe('box');
    expect(rowUnit(row('Stück'), t)).toBe('unit');
    expect(rowUnit(row('paquetes'), t)).toBe('package');
    expect(rowUnit(row('kg'), t)).toBe('weight');
  });

  it('falls back to the template default when the cell is blank', () => {
    expect(rowUnit(row(null), template({ default_unit: 'box' }))).toBe('box');
    expect(rowUnit(row(null), template({ default_unit: 'unit' }))).toBe('unit');
  });

  it('falls back rather than guessing at an unrecognised word', () => {
    expect(rowUnit(row('palés'), template({ default_unit: 'unit' }))).toBe('unit');
    expect(parseUnitWord('palés')).toBeNull();
  });

  it('reads the unit vocabulary in four languages', () => {
    expect(['box', 'karton', 'caja', 'carton'].map((w) => parseUnitWord(w)))
      .toEqual(['box', 'box', 'box', 'box']);
    expect(['pcs', 'stk', 'unidades', 'unites'].map((w) => parseUnitWord(w)))
      .toEqual(['unit', 'unit', 'unit', 'unit']);
  });
});

describe('quantity cells', () => {
  it.each([
    ['12', 12],
    ['12.5', 12.5],
    ['12,5', 12.5],
    [' 12 ', 12],
  ])('%s reads as %s', (text, expected) => {
    expect(parseQuantityCell(text)).toBe(expected);
  });

  it.each(['abc', '', '12 cajas', '-3', '1/2'])('%s is not a number', (text) => {
    expect(Number.isNaN(parseQuantityCell(text))).toBe(true);
  });
});
