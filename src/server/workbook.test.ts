import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { cellValue, readWorkbook } from './workbook';
import {
  extractRows,
  identifyTemplate,
  parseQuantityCell,
  rowUnit,
  type OrderRequestTemplate,
} from '@/domain/orders/import/template';
import { buildPreview, lineState, summarize } from '@/domain/orders/import/pipeline';
import type { PipelineProduct } from '@/domain/orders/import/pipeline';

/**
 * The Excel path, end to end, against a REAL workbook.
 *
 * The grid rules are tested against literal arrays elsewhere; what this test
 * covers is the seam nobody can reason about — that a genuine .xlsx, with the
 * merged title block, formula cells and blank catalogue rows a customer's
 * order request actually contains, comes out of exceljs as the grid those
 * rules expect.
 */

/** A customer's order request, built the way one really looks. */
async function buildWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pedido');

  ws.getCell('A1').value = 'ORDER REQUEST — ZZ Restaurant';
  ws.mergeCells('A1:D1');
  ws.getCell('A2').value = 'Semana 12';

  ws.getRow(3).values = ['Código', 'Producto', 'Cantidad', 'Comentario'];

  // Products the customer ordered, products they did not, and a formula.
  ws.getRow(4).values = ['0002', 'Bio Mais Tortillas 1kg - Ø14cm', 20, 'para el jueves'];
  ws.getRow(5).values = ['0073', 'Bio Mais Tortillas 1kg - Ø06cm', null, null];
  ws.getRow(6).values = ['0150', 'Panela Goya - Bloque - 454g', 6, null];
  ws.getRow(7).values = ['0200', 'Queso Oaxaca - 1kg', 0, 'no esta semana'];
  ws.getRow(8).values = ['0250', 'Totopos de Maíz - 6kg', null, null];
  // A quantity arrived at by a formula: the number the customer saw is 4.
  ws.getCell('A9').value = '0299';
  ws.getCell('B9').value = 'Achiote - Lol-Tun - 100g';
  ws.getCell('C9').value = { formula: 'SUM(2,2)', result: 4 };

  // A second sheet, which the template must not read.
  const other = wb.addWorksheet('Precios');
  other.getRow(1).values = ['Producto', 'Cantidad'];
  other.getRow(2).values = ['NO IMPORTAR', 999];

  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

const TEMPLATE: OrderRequestTemplate = {
  id: 'tpl-1',
  customer_id: 'cust-1',
  name: 'ZZ Restaurant weekly',
  sheet_name: 'Pedido',
  header_row: 3,
  first_data_row: 4,
  product_column: 'Producto',
  quantity_column: 'Cantidad',
  notes_column: 'Comentario',
  unit_column: null,
  default_unit: 'unit',
  header_signature: ['Producto', 'Cantidad'],
  is_active: true,
};

const P = (id: string, code: string, name: string, units_per_box: number | null = null): PipelineProduct => ({
  id, code, name, family: name, presentation: '—', is_active: true, units_per_box,
});

const PRODUCTS: PipelineProduct[] = [
  P('t14', '0002', 'Bio Mais Tortillas 1kg - Ø14cm'),
  P('t06', '0073', 'Bio Mais Tortillas 1kg - Ø06cm'),
  P('pan', '0150', 'Panela Goya - Bloque - 454g'),
  P('oax', '0200', 'Queso Oaxaca - 1kg', 12),
  P('tot', '0250', 'Totopos de Maíz - 6kg'),
  P('ach', '0299', 'Achiote - Lol-Tun - 100g'),
];

describe('reading a real workbook', () => {
  it('produces one rectangular grid per sheet', async () => {
    const sheets = await readWorkbook(await buildWorkbook());
    expect(sheets.map((s) => s.name)).toEqual(['Pedido', 'Precios']);
    const widths = new Set(sheets[0].rows.map((r) => r.length));
    expect(widths.size).toBe(1);
  });

  it('puts the header where the template says it is', async () => {
    const [pedido] = await readWorkbook(await buildWorkbook());
    // header_row 3 is 1-based; rows[2] is that row.
    expect(pedido.rows[2].slice(0, 4)).toEqual(['Código', 'Producto', 'Cantidad', 'Comentario']);
  });

  it('identifies the template from the sheet and headers, not the filename', async () => {
    const sheets = await readWorkbook(await buildWorkbook());
    const r = identifyTemplate(sheets, [TEMPLATE]);
    expect(r.status).toBe('identified');
    if (r.status === 'identified') expect(r.sheet.name).toBe('Pedido');
  });
});

describe('extracting the order from it', () => {
  it('reads only the rows the customer actually filled in', async () => {
    const sheets = await readWorkbook(await buildWorkbook());
    const r = extractRows(sheets[0], TEMPLATE);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;

    expect(r.rows.map((x) => [x.rowNumber, x.quantityText])).toEqual([
      [4, '20'],
      [6, '6'],
      [9, '4'],
    ]);
  });

  it('reads a formula cell as the number the customer saw', async () => {
    const sheets = await readWorkbook(await buildWorkbook());
    const r = extractRows(sheets[0], TEMPLATE);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(parseQuantityCell(r.rows[2].quantityText)).toBe(4);
  });

  it('carries the customer comment into the line note', async () => {
    const sheets = await readWorkbook(await buildWorkbook());
    const r = extractRows(sheets[0], TEMPLATE);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.rows[0].note).toBe('para el jueves');
  });

  it('never reads the other sheet', async () => {
    const sheets = await readWorkbook(await buildWorkbook());
    const r = extractRows(sheets[0], TEMPLATE);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.rows.some((x) => x.productText.includes('NO IMPORTAR'))).toBe(false);
  });
});

describe('the whole path: file to a preview', () => {
  it('every filled row matches a product and is ready to import', async () => {
    const sheets = await readWorkbook(await buildWorkbook());
    const extracted = extractRows(sheets[0], TEMPLATE);
    if (extracted.status !== 'ok') throw new Error('expected ok');

    const preview = buildPreview(
      extracted.rows.map((r) => ({
        sourceText: r.productText,
        productText: r.productText,
        quantity: parseQuantityCell(r.quantityText),
        unit: rowUnit(r, TEMPLATE),
        rowNumber: r.rowNumber,
        note: r.note,
      })),
      PRODUCTS,
      [],
      'cust-1',
    );

    expect(summarize(preview)).toEqual({ total: 3, ready: 3, review: 0, unknown: 0 });
    expect(preview.map((l) => [l.productId, l.quantity])).toEqual([
      ['t14', 20],
      ['pan', 6],
      ['ach', 4],
    ]);
  });

  it('a template that reads the quantity column as BOXES asks where it must', async () => {
    const sheets = await readWorkbook(await buildWorkbook());
    const boxTemplate = { ...TEMPLATE, default_unit: 'box' as const };
    const extracted = extractRows(sheets[0], boxTemplate);
    if (extracted.status !== 'ok') throw new Error('expected ok');

    const preview = buildPreview(
      extracted.rows.map((r) => ({
        sourceText: r.productText,
        productText: r.productText,
        quantity: parseQuantityCell(r.quantityText),
        unit: rowUnit(r, boxTemplate),
        rowNumber: r.rowNumber,
        note: r.note,
      })),
      PRODUCTS,
      [],
      'cust-1',
    );

    // None of these three products carries a units_per_box, so every line is
    // a question rather than an invented number.
    expect(preview.every((l) => l.quantity === null)).toBe(true);
    expect(preview.every((l) => l.quantityIssue === 'no_conversion')).toBe(true);
    expect(preview.every((l) => lineState(l) === 'review')).toBe(true);
  });
});

describe('cell values', () => {
  it('reads rich text as its text', () => {
    expect(cellValue({ richText: [{ text: 'Bio ' }, { text: 'Tortillas' }] })).toBe('Bio Tortillas');
  });

  it('reads a formula as its result, never as the formula', () => {
    expect(cellValue({ formula: 'SUM(A1:A2)', result: 12 })).toBe(12);
  });

  it('reads an error cell as empty rather than as a product', () => {
    expect(cellValue({ error: '#REF!' })).toBeNull();
  });

  it('reads a hyperlink as its label', () => {
    expect(cellValue({ text: 'Panela', hyperlink: 'https://example.com' })).toBe('Panela');
  });

  it('reads blanks as null', () => {
    expect(cellValue(null)).toBeNull();
    expect(cellValue(undefined)).toBeNull();
  });
});
