import 'server-only';

export type XlsxColumn = { header: string; key: string; width: number };

/** One sheet: bold frozen header, a filter on every column. */
export async function workbook(name: string, columns: XlsxColumn[], rows: Record<string, unknown>[]) {
  // Dynamic, so a large CommonJS dependency stays out of every other request.
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name);
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return wb.xlsx.writeBuffer();
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
