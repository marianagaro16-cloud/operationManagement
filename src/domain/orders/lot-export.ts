/**
 * Lot allocations as a spreadsheet.
 *
 * Semicolon-separated, quoting the same characters as `productReportToCsv` in
 * `reporting.ts` — the app already has one CSV convention and Excel in a
 * German/Swiss locale opens semicolon files directly, which comma files do
 * not. Reusing it rather than adding a second export format or an xlsx
 * dependency for one screen.
 *
 * Pure, so what is exported can be asserted in a unit test rather than
 * inspected by downloading it.
 */

export interface ExportableLotRow {
  lot_number: string;
  product_name: string;
  product_code: string | null;
  customer_name: string;
  customer_addition: string | null;
  order_reference: number;
  quantity: number;
  preparation_date: string;
  delivery_date: string;
  entered_by: string | null;
  modified_by: string | null;
  updated_at: string;
}

const HEADER = [
  'lot',
  'product',
  'product_code',
  'customer',
  'customer_addition',
  'order',
  'quantity',
  'preparation_date',
  'delivery_date',
  'entered_by',
  'last_modified_by',
  'last_modified',
];

function escape(value: string | number | null): string {
  const s = value === null ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Exports exactly the rows it is given.
 *
 * The caller passes the current filtered result, so the file matches what is
 * on screen. It never re-queries and never widens the set — an export that
 * quietly contained more than the search did would be worse than no export.
 */
export function lotAllocationsToCsv(rows: readonly ExportableLotRow[]): string {
  const lines = rows.map((r) =>
    [
      r.lot_number,
      r.product_name,
      r.product_code,
      r.customer_name,
      r.customer_addition,
      // The human-facing order number, matching what the app shows everywhere.
      `#${r.order_reference}`,
      r.quantity,
      r.preparation_date,
      r.delivery_date,
      r.entered_by,
      r.modified_by,
      // Date only: a spreadsheet column of ISO timestamps is unreadable, and
      // the audit trail is where the exact instant belongs.
      r.updated_at.slice(0, 10),
    ]
      .map(escape)
      .join(';'),
  );

  return [HEADER.join(';'), ...lines].join('\n');
}
