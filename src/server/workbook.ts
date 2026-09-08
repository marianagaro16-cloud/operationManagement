import type { Sheet } from '@/domain/orders/import/template';

/**
 * Workbook to plain grids.
 *
 * The ONLY place in the application that knows what an .xlsx is. Everything
 * downstream — which row is data, which column is quantity, what a product
 * name matches — works on the `Sheet` grids this produces, which is what lets
 * those rules be unit-tested against literal arrays instead of binary
 * fixtures.
 *
 * Deliberately NOT marked 'server-only', unlike its neighbours: it takes an
 * ArrayBuffer and returns arrays, touching neither the database nor the
 * request, and marking it would make it untestable for no gain. It is only
 * ever called from a server action.
 */

/** A workbook past this many rows is not an order request. */
const MAX_SHEET_ROWS = 5000;
/** Columns past this are beyond any real order request's product table. */
const MAX_SHEET_COLUMNS = 200;

/**
 * Read every worksheet into a rectangular grid.
 *
 * The uploaded file is never written anywhere and never modified: it is read
 * from the request buffer and discarded. The customer's own file is not this
 * application's to keep, and §17 says so explicitly.
 */
export async function readWorkbook(buffer: ArrayBuffer): Promise<Sheet[]> {
  // Dynamic, so a large CommonJS dependency stays out of every request that
  // is not an import.
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: Sheet[] = [];
  workbook.eachSheet((worksheet) => {
    const rowLimit = Math.min(worksheet.rowCount, MAX_SHEET_ROWS);
    const colLimit = Math.min(worksheet.columnCount, MAX_SHEET_COLUMNS);
    const rows: (string | number | null)[][] = [];

    for (let r = 1; r <= rowLimit; r++) {
      const row = worksheet.getRow(r);
      const cells: (string | number | null)[] = [];
      // Walked by width rather than by the row's own sparse cells, so a
      // column index means the same thing on every row — a ragged grid would
      // make "column B" mean different things on different lines.
      for (let c = 1; c <= colLimit; c++) {
        cells.push(cellValue(row.getCell(c).value));
      }
      rows.push(cells);
    }

    sheets.push({ name: worksheet.name, rows });
  });

  return sheets;
}

/**
 * One cell to a scalar.
 *
 * exceljs returns rich text, formulas, hyperlinks and dates as objects. A
 * formula cell carries its computed `result`, which is the number the
 * customer saw when they filled the sheet in and therefore the number they
 * meant — reading the formula text instead would import "=SUM(B2:B9)".
 */
export function cellValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const obj = value as Record<string, unknown>;
  if ('result' in obj) return cellValue(obj.result);
  if ('richText' in obj && Array.isArray(obj.richText)) {
    return obj.richText.map((r) => String((r as { text?: string }).text ?? '')).join('');
  }
  if ('text' in obj) return cellValue(obj.text);
  // An error cell (#REF!, #DIV/0!) and anything unrecognised read as empty,
  // which the extractor treats as "not ordered" rather than as a product.
  return null;
}
