import {
  isConditionProblem,
  type QuantityCheck,
  type ReceptionCondition,
  type ReceptionStatus,
} from './vocabulary';

/**
 * The monthly Goods Reception report, as pure aggregation.
 *
 * It takes rows and returns a document. It reads nothing, writes nothing and
 * knows no dates beyond the ones it is handed — which is what lets the same
 * function compute a live month for the screen AND the frozen payload stored
 * as a snapshot, with no possibility of the two disagreeing. Copied in shape
 * from `domain/incidents/report.ts` for exactly that reason.
 *
 * THE RULE THIS FILE IS BUILT AROUND, from §40 and §41:
 *
 *   AN ASSOCIATION IS NOT A CAUSE.
 *
 * "DHL carried 30 deliveries, 5 of which had incidents" is a join, and this
 * file will say it. "DHL caused 5 incidents" is a finding, and this file will
 * never say it — responsibility is a field somebody records during an
 * incident investigation, and it lives in the incident report, not here.
 *
 * Every figure below is therefore a COUNT OF RECEPTIONS with a property, and
 * the field names say so: `withIncidents`, not `causedIncidents`.
 */

/** One reception, flattened to what the aggregation needs. */
export interface ReportReception {
  id: string;
  reception_number: string;
  received_at: string;
  status: ReceptionStatus;
  condition: ReceptionCondition | null;
  quantity_check: QuantityCheck;

  supplier_id: string | null;
  supplier_name: string | null;
  transporter_id: string | null;
  transporter_name: string | null;

  received_by: string;
  received_by_name: string;

  /** Incidents linked to this reception. A count, never an attribution. */
  incident_count: number;
  /** Exceptional product records attached to it. */
  exception_count: number;
}

/** A named row with a count. The shape every breakdown below shares. */
export interface Bucket {
  key: string;
  label: string;
  count: number;
}

/**
 * A party the deliveries came through, with the counts that describe those
 * deliveries. Used for both suppliers (§40) and transporters (§41), because
 * the questions asked of each are identical.
 */
export interface PartyPerformance {
  id: string;
  name: string;
  receptions: number;
  withIncidents: number;
  incidents: number;
  withDiscrepancy: number;
  withConditionProblem: number;
  /**
   * Receptions with incidents as a share of that party's receptions, 0–1.
   *
   * Present only where the denominator is meaningful. §40 asks for rates
   * "where denominator data is reliable" — a supplier with two deliveries in
   * the month has a 50% incident rate the moment one goes wrong, which is a
   * number that misleads far more than it informs.
   */
  incidentRate: number | null;
}

/** Below this many deliveries, a percentage says more than it knows. */
export const MIN_RECEPTIONS_FOR_RATE = 5;

export interface ReceptionReportSummary {
  total: number;
  completed: number;
  /** Still draft, received or checking at the moment the report was taken. */
  open: number;
  withIncidents: number;
  incidents: number;
  withDiscrepancy: number;
  notChecked: number;
  withConditionProblem: number;
  withExceptions: number;
}

export interface ReceptionReportPayload {
  /** 'YYYY-MM' of the month reported on. */
  period: string;
  summary: ReceptionReportSummary;

  byStatus: Bucket[];
  byCondition: Bucket[];
  byQuantityCheck: Bucket[];
  byReceiver: Bucket[];

  suppliers: PartyPerformance[];
  transporters: PartyPerformance[];

  /**
   * Deliveries still not completed when the report was taken.
   *
   * Listed by number rather than counted, because §39 asks for open
   * receptions and a count alone gives nobody anything to act on.
   */
  openReceptions: { id: string; reception_number: string; received_at: string; status: ReceptionStatus }[];
}

/**
 * Rows with no supplier or no transporter recorded.
 *
 * Given an explicit bucket rather than being dropped: "we do not know who
 * brought 12 of this month's deliveries" is a finding about the data, and
 * silently omitting those rows would make the supplier counts add up to less
 * than the total with no explanation.
 */
export const UNRECORDED_KEY = '__unrecorded__';

export function buildReceptionReport(params: {
  period: string;
  receptions: ReportReception[];
  /** How to name the "not recorded" bucket. Passed in so this stays i18n-free. */
  unrecordedLabel: string;
}): ReceptionReportPayload {
  const { period, receptions, unrecordedLabel } = params;

  const summary: ReceptionReportSummary = {
    total: receptions.length,
    completed: receptions.filter((r) => r.status === 'completed').length,
    open: receptions.filter((r) => r.status !== 'completed').length,
    withIncidents: receptions.filter((r) => r.incident_count > 0).length,
    incidents: receptions.reduce((sum, r) => sum + r.incident_count, 0),
    withDiscrepancy: receptions.filter((r) => r.quantity_check === 'discrepancy').length,
    notChecked: receptions.filter((r) => r.quantity_check === 'not_checked').length,
    withConditionProblem: receptions.filter((r) => isConditionProblem(r.condition)).length,
    withExceptions: receptions.filter((r) => r.exception_count > 0).length,
  };

  return {
    period,
    summary,
    byStatus: countBy(receptions, (r) => [r.status, r.status]),
    // A reception with no condition recorded is not yet a statement about
    // condition, so it is absent rather than counted as good.
    byCondition: countBy(receptions, (r) => (r.condition ? [r.condition, r.condition] : null)),
    byQuantityCheck: countBy(receptions, (r) => [r.quantity_check, r.quantity_check]),
    byReceiver: countBy(receptions, (r) => [r.received_by, r.received_by_name]),

    suppliers: performance(
      receptions,
      (r) => r.supplier_id,
      (r) => r.supplier_name,
      unrecordedLabel,
    ),
    transporters: performance(
      receptions,
      (r) => r.transporter_id,
      (r) => r.transporter_name,
      unrecordedLabel,
    ),

    openReceptions: receptions
      .filter((r) => r.status !== 'completed')
      .map((r) => ({
        id: r.id,
        reception_number: r.reception_number,
        received_at: r.received_at,
        status: r.status,
      }))
      .sort((a, b) => a.received_at.localeCompare(b.received_at)),
  };
}

/** Count rows into named buckets, biggest first. `null` skips a row. */
function countBy<T>(rows: T[], keyOf: (row: T) => [string, string] | null): Bucket[] {
  const counts = new Map<string, { label: string; count: number }>();

  for (const row of rows) {
    const pair = keyOf(row);
    if (!pair) continue;
    const [key, label] = pair;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label, count: 1 });
  }

  return [...counts.entries()]
    .map(([key, { label, count }]) => ({ key, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function performance<T extends ReportReception>(
  rows: T[],
  idOf: (row: T) => string | null,
  nameOf: (row: T) => string | null,
  unrecordedLabel: string,
): PartyPerformance[] {
  const parties = new Map<string, PartyPerformance>();

  for (const row of rows) {
    const id = idOf(row) ?? UNRECORDED_KEY;
    const name = (id === UNRECORDED_KEY ? unrecordedLabel : nameOf(row)) ?? unrecordedLabel;

    let party = parties.get(id);
    if (!party) {
      party = {
        id,
        name,
        receptions: 0,
        withIncidents: 0,
        incidents: 0,
        withDiscrepancy: 0,
        withConditionProblem: 0,
        incidentRate: null,
      };
      parties.set(id, party);
    }

    party.receptions += 1;
    party.incidents += row.incident_count;
    if (row.incident_count > 0) party.withIncidents += 1;
    if (row.quantity_check === 'discrepancy') party.withDiscrepancy += 1;
    if (isConditionProblem(row.condition)) party.withConditionProblem += 1;
  }

  for (const party of parties.values()) {
    party.incidentRate =
      party.receptions >= MIN_RECEPTIONS_FOR_RATE
        ? party.withIncidents / party.receptions
        : null;
  }

  return [...parties.values()].sort(
    (a, b) => b.receptions - a.receptions || a.name.localeCompare(b.name),
  );
}

/**
 * Deterministic recurrence detection. §44: no AI, no inference of causality.
 *
 * A pattern here is nothing more than "this exact thing happened at least N
 * times in the period". It is a prompt to go and look, never a conclusion,
 * and the wording of every label it produces is the caller's to choose.
 */
export interface ReceptionPattern {
  kind: 'supplier_incidents' | 'transporter_incidents' | 'discrepancies' | 'condition_problems';
  key: string;
  label: string;
  count: number;
}

export const DEFAULT_PATTERN_THRESHOLD = 3;

export function detectReceptionPatterns(
  payload: ReceptionReportPayload,
  threshold: number = DEFAULT_PATTERN_THRESHOLD,
): ReceptionPattern[] {
  const patterns: ReceptionPattern[] = [];

  for (const supplier of payload.suppliers) {
    if (supplier.withIncidents >= threshold) {
      patterns.push({
        kind: 'supplier_incidents',
        key: supplier.id,
        label: supplier.name,
        count: supplier.withIncidents,
      });
    }
    if (supplier.withDiscrepancy >= threshold) {
      patterns.push({
        kind: 'discrepancies',
        key: supplier.id,
        label: supplier.name,
        count: supplier.withDiscrepancy,
      });
    }
    if (supplier.withConditionProblem >= threshold) {
      patterns.push({
        kind: 'condition_problems',
        key: supplier.id,
        label: supplier.name,
        count: supplier.withConditionProblem,
      });
    }
  }

  for (const transporter of payload.transporters) {
    if (transporter.withIncidents >= threshold) {
      patterns.push({
        kind: 'transporter_incidents',
        key: transporter.id,
        label: transporter.name,
        count: transporter.withIncidents,
      });
    }
  }

  return patterns.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
