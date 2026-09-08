import { fold } from '@/lib/search';
import type { DetectedUnit } from './packaging';

/**
 * Order Request template mapping.
 *
 * A customer's Order Request workbook is read through a CONFIGURED MAPPING,
 * never through code written for that customer. The alternative — an importer
 * per customer — means a deployment every time somebody inserts a column, and
 * fifteen near-identical readers that drift apart.
 *
 * Everything in this file is pure and works on a plain grid of cell values.
 * The workbook library is confined to the server action that produces that
 * grid, so every rule about which row is data and which column is quantity is
 * unit-tested against literal arrays rather than against a fixture file.
 */

/** A worksheet reduced to what the mapping needs. */
export interface Sheet {
  name: string;
  /**
   * Row-major cell values, 0-indexed. Row 0 is spreadsheet row 1.
   * Ragged rows are expected; missing cells read as undefined.
   */
  rows: (string | number | null | undefined)[][];
}

/** The stored mapping. Mirrors `public.order_request_templates`. */
export interface OrderRequestTemplate {
  id: string;
  customer_id: string;
  name: string;
  sheet_name: string | null;
  /** 1-based. Null when the file has no header row. */
  header_row: number | null;
  /** 1-based. */
  first_data_row: number;
  product_column: string;
  quantity_column: string;
  notes_column: string | null;
  unit_column: string | null;
  default_unit: 'unit' | 'box';
  header_signature: string[];
  is_active: boolean;
}

/** One requested row, before any product matching or quantity conversion. */
export interface RawRequestRow {
  /** 1-based spreadsheet row, so the preview can say where a problem is. */
  rowNumber: number;
  productText: string;
  quantityText: string;
  unitText: string | null;
  note: string | null;
}

/* ---------------------------- column addressing --------------------------- */

/**
 * Columns are addressed EITHER by spreadsheet letter or by header label.
 *
 * Neither alone is right. A letter survives a customer renaming their header
 * and breaks when they insert a column; a label survives the insert and breaks
 * on the rename. Supporting both lets whoever configures the template pick the
 * one that matches how that customer actually edits their file.
 */
export function isColumnLetter(spec: string): boolean {
  return /^[A-Za-z]{1,3}$/.test(spec.trim());
}

/** "A" -> 0, "B" -> 1, "AA" -> 26. */
export function columnLetterToIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.trim().toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

/**
 * Resolve a column spec against a sheet.
 *
 * A letter resolves without the file being consulted at all. A label is
 * matched against the header row, folded — so "Producto", "PRODUCTO" and
 * "producto " are the same header, which is the difference between a template
 * that works and one that breaks on a customer's capitalisation.
 *
 * Returns null when the column cannot be found, which the caller reports
 * rather than working around.
 */
export function resolveColumn(
  spec: string | null | undefined,
  sheet: Sheet,
  headerRow: number | null,
): number | null {
  const s = (spec ?? '').trim();
  if (!s) return null;
  if (isColumnLetter(s)) return columnLetterToIndex(s);

  if (headerRow === null) return null;
  const header = sheet.rows[headerRow - 1];
  if (!header) return null;

  const wanted = fold(s);
  const exact = header.findIndex((cell) => fold(cellText(cell)) === wanted);
  if (exact >= 0) return exact;

  // A header that merely contains the label — "Cantidad (cajas)" for
  // "Cantidad". Accepted only when exactly one column does, so a file with
  // "Cantidad pedida" and "Cantidad confirmada" is reported instead of
  // silently reading the first.
  const partial = header
    .map((cell, i) => ({ i, text: fold(cellText(cell)) }))
    .filter(({ text }) => text.length > 0 && text.includes(wanted));
  return partial.length === 1 ? partial[0].i : null;
}

/* --------------------------- template identification ---------------------- */

export type IdentifyResult =
  | { status: 'identified'; template: OrderRequestTemplate; sheet: Sheet }
  | { status: 'not_found' }
  | { status: 'ambiguous'; templates: OrderRequestTemplate[] };

/**
 * Which of this customer's templates does this workbook match?
 *
 * Filenames are deliberately not consulted. Customers rename files, mail
 * clients append "(2)", and a file called "order.xlsx" tells you nothing —
 * matching on it would let one customer's workbook import as another's
 * format, which is silent and severe.
 *
 * A template claims a workbook when its sheet is present AND every header in
 * its signature appears on the header row. A template with an empty signature
 * claims any workbook containing its sheet, which is the escape hatch for a
 * file too plain to fingerprint.
 */
export function identifyTemplate(
  sheets: Sheet[],
  templates: OrderRequestTemplate[],
): IdentifyResult {
  const matches: { template: OrderRequestTemplate; sheet: Sheet }[] = [];

  for (const template of templates.filter((t) => t.is_active)) {
    const sheet = pickSheet(sheets, template.sheet_name);
    if (!sheet) continue;
    if (!signatureMatches(sheet, template)) continue;
    matches.push({ template, sheet });
  }

  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length === 1) return { status: 'identified', ...matches[0] };

  // More than one template fits. The user picks; the importer does not.
  // Ordered most-specific-first so the likeliest is offered at the top.
  return {
    status: 'ambiguous',
    templates: matches
      .sort((a, b) => b.template.header_signature.length - a.template.header_signature.length)
      .map((m) => m.template),
  };
}

/** The named sheet, or the first one when the template does not name a sheet. */
export function pickSheet(sheets: Sheet[], sheetName: string | null): Sheet | null {
  if (!sheetName) return sheets[0] ?? null;
  const wanted = fold(sheetName.trim());
  return sheets.find((s) => fold(s.name.trim()) === wanted) ?? null;
}

function signatureMatches(sheet: Sheet, template: OrderRequestTemplate): boolean {
  if (template.header_signature.length === 0) return true;
  if (template.header_row === null) return false;
  const header = sheet.rows[template.header_row - 1];
  if (!header) return false;
  const present = header.map((cell) => fold(cellText(cell))).filter(Boolean);
  return template.header_signature.every((label) => {
    const wanted = fold(label.trim());
    return wanted.length > 0 && present.some((h) => h === wanted || h.includes(wanted));
  });
}

/* ------------------------------- extraction ------------------------------- */

export type ExtractResult =
  | { status: 'ok'; rows: RawRequestRow[] }
  | { status: 'column_not_found'; column: 'product' | 'quantity' };

/**
 * Pull the requested rows out of a mapped sheet.
 *
 * A customer does not delete the rows they are not ordering — they leave the
 * quantity blank on a template listing the full catalogue. So a row counts as
 * requested only when it names a product AND carries a quantity; everything
 * else is skipped in silence, because a hundred "no quantity" warnings on a
 * hundred-row catalogue would bury the one line that actually needs a person.
 *
 * A row with a quantity and NO product is the opposite case and is kept, with
 * empty product text, so the preview can show it as unidentified rather than
 * losing an order line to a formatting slip.
 */
export function extractRows(sheet: Sheet, template: OrderRequestTemplate): ExtractResult {
  const productCol = resolveColumn(template.product_column, sheet, template.header_row);
  if (productCol === null) return { status: 'column_not_found', column: 'product' };

  const quantityCol = resolveColumn(template.quantity_column, sheet, template.header_row);
  if (quantityCol === null) return { status: 'column_not_found', column: 'quantity' };

  const notesCol = resolveColumn(template.notes_column, sheet, template.header_row);
  const unitCol = resolveColumn(template.unit_column, sheet, template.header_row);

  const rows: RawRequestRow[] = [];
  for (let i = template.first_data_row - 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    if (!row) continue;

    const productText = cellText(row[productCol]);
    const quantityText = cellText(row[quantityCol]);

    // Not ordered on this line. The overwhelmingly common case.
    if (!quantityText) continue;
    // A quantity of literal zero is "not ordered" written explicitly.
    if (/^0+([.,]0+)?$/.test(quantityText)) continue;

    rows.push({
      rowNumber: i + 1,
      productText,
      quantityText,
      unitText: unitCol === null ? null : cellText(row[unitCol]) || null,
      note: notesCol === null ? null : cellText(row[notesCol]) || null,
    });
  }

  return { status: 'ok', rows };
}

/* --------------------------------- units ---------------------------------- */

/**
 * The unit for one extracted row.
 *
 * A unit column in the file wins, because the customer stated it. Otherwise
 * the template's configured default applies. Nothing is inferred from the
 * header text — a column headed "Cajas" means boxes only when a person
 * configured the template to say so.
 */
export function rowUnit(row: RawRequestRow, template: OrderRequestTemplate): DetectedUnit {
  if (row.unitText) {
    const parsed = parseUnitWord(row.unitText);
    if (parsed) return parsed;
  }
  return template.default_unit === 'box' ? 'box' : 'unit';
}

/**
 * A unit word from a spreadsheet cell.
 *
 * The same four-language vocabulary the email parser uses, kept deliberately
 * narrow: an unrecognised word returns null and falls back to the template's
 * default rather than being guessed at.
 */
export function parseUnitWord(text: string): DetectedUnit | null {
  const w = fold(text.trim()).replace(/[^\p{L}]/gu, '');
  if (!w) return null;

  if (/^(box|boxes|carton|cartons|case|cases|karton|kartons|kiste|kisten|schachtel|caja|cajas|cartones|caisse|caisses|boite|boites)$/.test(w)) {
    return 'box';
  }
  if (/^(package|packages|pack|packs|bag|bags|packung|packungen|beutel|paquete|paquetes|bolsa|bolsas|paquet|paquets|sachet|sachets)$/.test(w)) {
    return 'package';
  }
  if (/^(unit|units|pc|pcs|piece|pieces|stuck|stk|einheit|einheiten|unidad|unidades|ud|uds|pieza|piezas|unite|unites)$/.test(w)) {
    return 'unit';
  }
  if (/^(kg|kgs|kilo|kilos|g|gr|gram|grams|gramm|gramo|gramos|l|lt|liter|litre|litro|ml)$/.test(w)) {
    return 'weight';
  }
  return null;
}

/**
 * A quantity cell to a number.
 *
 * Accepts "12", "12.5", "12,5" and " 12 " — the shapes a spreadsheet actually
 * produces. Returns NaN for anything else, which the caller reports as an
 * invalid quantity rather than coercing to zero.
 */
export function parseQuantityCell(text: string): number {
  const cleaned = text.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}
