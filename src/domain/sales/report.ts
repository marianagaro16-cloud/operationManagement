/**
 * The sales report's arithmetic and its CSV. Units and net kg only — the app
 * has no prices.
 */

export interface ReportRow {
  id: string | null;
  name: string;
  /** Product code, or the customer's city — the second column where there is one. */
  detail?: string | null;
  customers?: number;
  quantity: number;
  kg: number;
  prev_quantity: number;
  prev_kg: number;
}

/** Change against the period before, in whole %; null when there was nothing before. */
export function changePct(now: number, before: number): number | null {
  const a = Number(now);
  const b = Number(before);
  if (!b) return null;
  return Math.round(((a - b) / b) * 100);
}

/**
 * Semicolon-separated, like the orders report, so Excel with a Swiss locale
 * opens it in columns. Numbers keep a dot; the change is blank without a
 * previous period rather than a misleading 0.
 */
export function salesReportToCsv(rows: ReportRow[], columns: { name: string; detail?: string }): string {
  const escape = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    columns.name,
    ...(columns.detail ? [columns.detail] : []),
    'units', 'kg', 'units_before', 'kg_before', 'change_units_pct',
  ];
  const body = rows.map((r) =>
    [
      r.name,
      ...(columns.detail ? [r.detail ?? ''] : []),
      Number(r.quantity), Number(r.kg), Number(r.prev_quantity), Number(r.prev_kg),
      changePct(r.quantity, r.prev_quantity) ?? '',
    ].map(escape).join(';'),
  );
  return [header.join(';'), ...body].join('\n');
}
