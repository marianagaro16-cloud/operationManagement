import type { IncidentReportPayload } from './report';

/**
 * Incidents as a spreadsheet.
 *
 * Semicolon-separated, quoting the same characters as `productReportToCsv` in
 * orders/reporting.ts and `lotAllocationsToCsv` in orders/lot-export.ts. The
 * app has one CSV convention and Excel in a German/Swiss locale opens
 * semicolon files directly, which comma files do not. A third convention —
 * or an xlsx dependency for two screens — would be worse than reusing this.
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

/* ----------------------------- incident list ---------------------------- */

export interface ExportableIncident {
  incident_number: string;
  detected_at: string;
  status: string;
  severity: string;
  customer_name: string | null;
  order_reference: number | null;
  category: string;
  type: string;
  products: string;
  affected_quantity: number | null;
  primary_cause: string | null;
  secondary_causes: string;
  responsibility: string;
  delivery_method: string | null;
  replacement_count: number;
  corrective_action_count: number;
  description: string;
  resolved_at: string | null;
  closed_at: string | null;
}

const INCIDENT_HEADER = [
  'incident',
  'detected',
  'status',
  'severity',
  'customer',
  'order',
  'category',
  'type',
  'products',
  'affected_quantity',
  'primary_cause',
  'secondary_causes',
  'responsibility',
  'delivery_method',
  'replacements',
  'corrective_actions',
  'description',
  'resolved',
  'closed',
];

/**
 * Exports exactly the rows it is given.
 *
 * The filtering happens in the query, so an export is the list the person is
 * looking at — §28. A function that re-filtered here could disagree with the
 * screen, and the export is the artefact that leaves the building.
 */
export function incidentsToCsv(rows: ExportableIncident[]): string {
  return toCsv(
    INCIDENT_HEADER,
    rows.map((r) => [
      r.incident_number,
      r.detected_at,
      r.status,
      r.severity,
      r.customer_name,
      r.order_reference,
      r.category,
      r.type,
      r.products,
      r.affected_quantity,
      r.primary_cause,
      r.secondary_causes,
      r.responsibility,
      r.delivery_method,
      r.replacement_count,
      r.corrective_action_count,
      r.description,
      r.resolved_at,
      r.closed_at,
    ]),
  );
}

/* ---------------------------- monthly report ---------------------------- */

/**
 * The monthly report as one long, flat sheet.
 *
 * A section column rather than several files, because a manager pastes this
 * into one tab and filters it. Vocabulary keys are exported alongside their
 * translated labels: the key is what a later analysis joins on, the label is
 * what a human reads, and exporting only one of them loses whichever the
 * reader needed.
 */
export function reportToCsv(
  payload: IncidentReportPayload,
  /** Translator for vocabulary keys, supplied by the caller with the locale. */
  translate: (section: string, key: string) => string,
): string {
  const rows: (string | number | null)[][] = [];

  const section = (name: string, buckets: { key: string; label: string | null; count: number }[]) => {
    for (const b of buckets) {
      rows.push([name, b.key, b.label ?? translate(name, b.key), b.count]);
    }
  };

  const s = payload.summary;
  for (const [key, value] of Object.entries(s)) {
    rows.push(['summary', key, translate('summary', key), value]);
  }

  section('category', payload.byCategory);
  section('type', payload.byType);
  section('severity', payload.bySeverity);
  section('primary_cause', payload.byPrimaryCause);
  section('secondary_cause', payload.bySecondaryCause);
  section('responsibility', payload.byResponsibility);
  section('customer', payload.byCustomer);
  section('product', payload.byProduct);
  // Defaulted, not assumed: a snapshot frozen before brands existed has no
  // byBrand and must still export.
  section('brand', payload.byBrand ?? []);
  section('delivery_method', payload.byDeliveryMethod);

  const a = payload.correctiveActions;
  for (const [key, value] of Object.entries(a)) {
    rows.push(['corrective_actions', key, translate('corrective_actions', key), value]);
  }

  // Patterns carry their kind, so a reader of the spreadsheet can still tell
  // an association from a recorded finding once the styling is gone.
  for (const p of payload.patterns) {
    rows.push([
      'pattern',
      `${p.dimension}:${p.key}`,
      `${p.kind} · ${p.label ?? translate(p.dimension, p.key)} (${p.count}/${p.outOf})`,
      p.count,
    ]);
  }

  return toCsv(['section', 'key', 'label', 'value'], rows);
}
