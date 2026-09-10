import type { ReceptionReportPayload } from './report';

/**
 * Goods Receptions as a spreadsheet.
 *
 * Semicolon-separated, quoting the same characters as `incidentsToCsv` and
 * `productReportToCsv`. The app has one CSV convention and Excel in a
 * German/Swiss locale opens semicolon files directly, which comma files do
 * not. A third convention — or an xlsx dependency for two more screens —
 * would be worse than reusing this.
 *
 * Pure, so what is exported is asserted in a unit test rather than checked by
 * downloading it.
 */

function escape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return [header, ...rows].map((r) => r.map(escape).join(';')).join('\n');
}

/* ---------------------------- reception list ---------------------------- */

export interface ExportableReception {
  reception_number: string;
  received_at: string;
  status: string;
  supplier: string | null;
  transporter: string | null;
  delivery_note: string | null;
  received_by: string;
  condition: string | null;
  quantity_check: string;
  exception_count: number;
  incident_count: number;
  comments: string | null;
}

const RECEPTION_HEADER = [
  'reception',
  'received_at',
  'status',
  'supplier',
  'transporter',
  'delivery_note',
  'received_by',
  'condition',
  'quantity_check',
  'exceptions',
  'incidents',
  'comments',
];

export function receptionsToCsv(rows: ExportableReception[]): string {
  return toCsv(
    RECEPTION_HEADER,
    rows.map((r) => [
      r.reception_number,
      r.received_at,
      r.status,
      r.supplier,
      r.transporter,
      r.delivery_note,
      r.received_by,
      r.condition,
      r.quantity_check,
      r.exception_count,
      r.incident_count,
      r.comments,
    ]),
  );
}

/* --------------------------- the monthly report -------------------------- */

/**
 * The frozen report as one file, in sections.
 *
 * Sections rather than a single flat grid, because the report genuinely is
 * several tables — and because flattening supplier rows next to summary rows
 * is how a spreadsheet becomes something nobody can pivot.
 *
 * The rate column is written as an empty cell when the denominator was too
 * small to support one. §40: a blank is honest, "0%" and "50%" off two
 * deliveries are not.
 */
export function receptionReportToCsv(payload: ReceptionReportPayload): string {
  const lines: string[] = [];

  lines.push(toCsv(['period'], [[payload.period]]));
  lines.push('');

  lines.push(
    toCsv(
      ['metric', 'value'],
      [
        ['total', payload.summary.total],
        ['completed', payload.summary.completed],
        ['open', payload.summary.open],
        ['receptions_with_incidents', payload.summary.withIncidents],
        ['incidents_total', payload.summary.incidents],
        ['quantity_discrepancies', payload.summary.withDiscrepancy],
        ['not_checked', payload.summary.notChecked],
        ['condition_problems', payload.summary.withConditionProblem],
        ['with_exceptions', payload.summary.withExceptions],
      ],
    ),
  );
  lines.push('');

  const party = (
    title: string,
    rows: ReceptionReportPayload['suppliers'],
  ): string =>
    toCsv(
      [title, 'receptions', 'receptions_with_incidents', 'incidents', 'discrepancies', 'condition_problems', 'incident_rate'],
      rows.map((p) => [
        p.name,
        p.receptions,
        p.withIncidents,
        p.incidents,
        p.withDiscrepancy,
        p.withConditionProblem,
        // Blank, not zero, when there were too few deliveries to rate.
        p.incidentRate === null ? '' : (p.incidentRate * 100).toFixed(1),
      ]),
    );

  lines.push(party('supplier', payload.suppliers));
  lines.push('');
  lines.push(party('transporter', payload.transporters));
  lines.push('');

  const buckets = (title: string, rows: { label: string; count: number }[]): string =>
    toCsv([title, 'count'], rows.map((b) => [b.label, b.count]));

  lines.push(buckets('condition', payload.byCondition));
  lines.push('');
  lines.push(buckets('quantity_check', payload.byQuantityCheck));
  lines.push('');
  lines.push(buckets('received_by', payload.byReceiver));
  lines.push('');

  lines.push(
    toCsv(
      ['open_reception', 'received_at', 'status'],
      payload.openReceptions.map((r) => [r.reception_number, r.received_at, r.status]),
    ),
  );

  return lines.join('\n');
}
