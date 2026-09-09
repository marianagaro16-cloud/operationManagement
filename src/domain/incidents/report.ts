import {
  isOpen,
  isSerious,
  type IncidentCause,
  type IncidentResponsibility,
  type IncidentSeverity,
  type IncidentStatus,
} from './vocabulary';
import { detectPatterns, type Pattern } from './patterns';

/**
 * The monthly incident report, as pure aggregation.
 *
 * It takes rows and returns a document. It reads nothing, writes nothing and
 * knows no dates beyond the ones it is handed — which is what lets the same
 * function compute a live month for the screen AND the frozen payload that is
 * stored as a snapshot, with no possibility of the two disagreeing.
 *
 * THE RULE THIS FILE IS BUILT AROUND, from §12, §25 and §40:
 *
 *   An association is not a cause.
 *
 * "DHL was the delivery method on 5 incidents" is a join, and this file will
 * say it. "DHL caused 5 incidents" is a finding, and this file will only say
 * it where somebody recorded responsibility = 'transporter'. The two live in
 * separate sections of the payload precisely so a reader cannot mistake one
 * for the other, and so no future edit can quietly merge them.
 */

/** One incident, flattened to what the aggregation needs. */
export interface ReportIncident {
  id: string;
  incident_number: string;
  detected_at: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  primary_cause: IncidentCause | null;
  responsibility: IncidentResponsibility;
  secondary_causes: IncidentCause[];

  customer_id: string | null;
  customer_name: string | null;
  order_id: string | null;
  delivery_method_id: string | null;
  delivery_method_name: string | null;

  category_slug: string;
  type_slug: string;

  /**
   * Distinct products on the incident, already de-duplicated by the query.
   *
   * The brand rides along on the product rather than on the incident, because
   * one incident can touch products of several brands and the report has to
   * be able to say so.
   */
  products: {
    id: string;
    name: string;
    code: string | null;
    brandId: string | null;
    brandName: string | null;
  }[];
  replacement_count: number;
}

/** One corrective action, which is an occurrence of a one-off task. */
export interface ReportAction {
  occurrence_id: string;
  incident_id: string | null;
  due_date: string;
  status: 'pending' | 'completed' | 'skipped';
  completed_at: string | null;
}

/** A counted bucket. `key` is the stable identifier; the UI translates it. */
export interface Bucket {
  key: string;
  /**
   * A name that has no translation — a customer, a product, a delivery
   * method. Null for a vocabulary value, which the dictionaries own.
   */
  label: string | null;
  count: number;
}

export interface ReportSummary {
  total: number;
  ordersAffected: number;
  customersAffected: number;
  productsAffected: number;
  replacements: number;
  open: number;
  resolved: number;
  closed: number;
  high: number;
  critical: number;
}

export interface ActionSummary {
  total: number;
  open: number;
  overdue: number;
  dueThisPeriod: number;
  completed: number;
}

/**
 * The frozen document.
 *
 * Stored verbatim as `incident_report_snapshots.payload`, so its shape is
 * part of the data and not merely of the UI. Additive changes only: a
 * September snapshot written today must still render after this interface
 * grows a field in December, which is why every consumer reads defensively.
 */
export interface IncidentReportPayload {
  /** Schema version of the payload itself, so an old snapshot stays readable. */
  schema: 1;
  period: { month: string; from: string; to: string };
  summary: ReportSummary;

  /** WHERE are we failing. */
  byCategory: Bucket[];
  byType: Bucket[];
  bySeverity: Bucket[];

  /** WHY — recorded findings only. */
  byPrimaryCause: Bucket[];
  bySecondaryCause: Bucket[];
  byResponsibility: Bucket[];

  /** WHO and WHAT was involved. Association, not causation. */
  byCustomer: Bucket[];
  byProduct: Bucket[];
  /**
   * Incidents per brand. OPTIONAL, because snapshots frozen before brands
   * existed do not carry it and must still render — the payload is versioned
   * data, and every reader here defaults it rather than assuming.
   *
   * Unclassified products are counted under the key '__none__' with a null
   * label, which the caller translates, exactly like a vocabulary bucket.
   */
  byBrand?: Bucket[];
  byDeliveryMethod: Bucket[];

  correctiveActions: ActionSummary;
  patterns: Pattern[];

  /** Every incident the numbers were computed from, for drill-down. */
  incidentIds: string[];
}

/* ------------------------------ counting ------------------------------- */

function tally(
  incidents: ReportIncident[],
  pick: (i: ReportIncident) => { key: string; label: string | null } | null,
): Bucket[] {
  const counts = new Map<string, Bucket>();
  for (const incident of incidents) {
    const got = pick(incident);
    if (!got) continue;
    const existing = counts.get(got.key);
    if (existing) existing.count++;
    else counts.set(got.key, { key: got.key, label: got.label, count: 1 });
  }
  return sortBuckets([...counts.values()]);
}

/**
 * Most frequent first, then by key.
 *
 * The tiebreak is on the stable key rather than the label so that the same
 * data produces the same report in all three languages — a snapshot generated
 * by a German-speaking manager and one generated by a Spanish-speaking one
 * must be the same document.
 */
function sortBuckets(buckets: Bucket[]): Bucket[] {
  return buckets.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function distinct<T>(values: (T | null | undefined)[]): number {
  return new Set(values.filter((v): v is T => v !== null && v !== undefined)).size;
}

/* ------------------------------ the report ------------------------------ */

export function buildReport(params: {
  month: string;
  from: string;
  to: string;
  incidents: ReportIncident[];
  actions: ReportAction[];
  /** Business today, for deciding what is overdue. Never the ambient clock. */
  today: string;
}): IncidentReportPayload {
  const { month, from, to, incidents, actions, today } = params;

  const summary: ReportSummary = {
    total: incidents.length,
    ordersAffected: distinct(incidents.map((i) => i.order_id)),
    customersAffected: distinct(incidents.map((i) => i.customer_id)),
    productsAffected: distinct(incidents.flatMap((i) => i.products.map((p) => p.id))),
    replacements: incidents.reduce((n, i) => n + i.replacement_count, 0),
    open: incidents.filter((i) => isOpen(i.status)).length,
    resolved: incidents.filter((i) => i.status === 'resolved').length,
    closed: incidents.filter((i) => i.status === 'closed').length,
    high: incidents.filter((i) => i.severity === 'high').length,
    critical: incidents.filter((i) => i.severity === 'critical').length,
  };

  // A product appears once per incident however many lines it is on, so
  // "Queso Oaxaca — 7 incidents" counts incidents and not order lines.
  const byProduct = (() => {
    const counts = new Map<string, Bucket>();
    for (const incident of incidents) {
      for (const product of dedupeById(incident.products)) {
        const existing = counts.get(product.id);
        if (existing) existing.count++;
        else {
          counts.set(product.id, {
            key: product.id,
            label: product.code ? `${product.code} · ${product.name}` : product.name,
            count: 1,
          });
        }
      }
    }
    return sortBuckets([...counts.values()]);
  })();

  // An incident counts ONCE per brand it touched, however many of that
  // brand's products were on it — the question is "how many incidents
  // involved Del Barrio", not "how many product rows". An incident spanning
  // two brands therefore counts in both, so these do not sum to the total.
  const byBrand = (() => {
    const counts = new Map<string, Bucket>();
    for (const incident of incidents) {
      const brands = new Map<string, string | null>();
      for (const product of dedupeById(incident.products)) {
        brands.set(product.brandId ?? '__none__', product.brandName);
      }
      for (const [key, name] of brands) {
        const existing = counts.get(key);
        if (existing) existing.count++;
        else counts.set(key, { key, label: name, count: 1 });
      }
    }
    return sortBuckets([...counts.values()]);
  })();

  // A secondary cause is counted once per incident that recorded it. An
  // incident listing two contributing causes contributes to both buckets,
  // which is why these do not sum to the incident total — and why they are
  // reported separately from primary causes rather than added to them.
  const bySecondaryCause = (() => {
    const counts = new Map<string, Bucket>();
    for (const incident of incidents) {
      for (const cause of new Set(incident.secondary_causes)) {
        const existing = counts.get(cause);
        if (existing) existing.count++;
        else counts.set(cause, { key: cause, label: null, count: 1 });
      }
    }
    return sortBuckets([...counts.values()]);
  })();

  return {
    schema: 1,
    period: { month, from, to },
    summary,

    byCategory: tally(incidents, (i) => ({ key: i.category_slug, label: null })),
    byType: tally(incidents, (i) => ({ key: i.type_slug, label: null })),
    bySeverity: tally(incidents, (i) => ({ key: i.severity, label: null })),

    // Only incidents somebody actually investigated appear here. An
    // uninvestigated incident is absent rather than counted as 'unknown',
    // because "we have not looked yet" and "we looked and cannot tell" are
    // different facts and the report must not merge them.
    byPrimaryCause: tally(incidents, (i) =>
      i.primary_cause ? { key: i.primary_cause, label: null } : null,
    ),
    bySecondaryCause,
    byResponsibility: tally(incidents, (i) => ({ key: i.responsibility, label: null })),

    byCustomer: tally(incidents, (i) =>
      i.customer_id ? { key: i.customer_id, label: i.customer_name } : null,
    ),
    byProduct,
    byBrand,
    byDeliveryMethod: tally(incidents, (i) =>
      i.delivery_method_id
        ? { key: i.delivery_method_id, label: i.delivery_method_name }
        : null,
    ),

    correctiveActions: summariseActions(actions, from, to, today),
    patterns: detectPatterns(incidents, { from, to }),

    incidentIds: incidents.map((i) => i.id),
  };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

/**
 * Corrective actions, counted against the period.
 *
 * `overdue` is measured against TODAY rather than against the end of the
 * period, because an action that was due in September and is still open in
 * December is overdue now — reporting it as "on time as of 30 September"
 * would be technically true and operationally useless.
 */
export function summariseActions(
  actions: ReportAction[],
  from: string,
  to: string,
  today: string,
): ActionSummary {
  const open = actions.filter((a) => a.status === 'pending');
  return {
    total: actions.length,
    open: open.length,
    overdue: open.filter((a) => a.due_date < today).length,
    dueThisPeriod: actions.filter((a) => a.due_date >= from && a.due_date <= to).length,
    completed: actions.filter((a) => a.status === 'completed').length,
  };
}

/* ----------------------------- comparison ------------------------------ */

export interface BucketDelta {
  key: string;
  label: string | null;
  previous: number;
  current: number;
  /** current - previous. Negative is fewer incidents, which is an improvement. */
  change: number;
}

/**
 * Two periods, side by side.
 *
 * Returns arithmetic and nothing else. §27 is explicit that the report may
 * say "incidents decreased after the corrective action" and may not say the
 * action caused it — so this function has no concept of a corrective action,
 * cannot correlate one, and the wording lives in the dictionaries where it
 * can be reviewed.
 *
 * Buckets absent from one side are included with a zero, because a category
 * that appeared for the first time this month is exactly what a reader is
 * looking for and silently omitting it would hide it.
 */
export function compareBuckets(previous: Bucket[], current: Bucket[]): BucketDelta[] {
  const keys = new Set([...previous.map((b) => b.key), ...current.map((b) => b.key)]);
  const prev = new Map(previous.map((b) => [b.key, b]));
  const curr = new Map(current.map((b) => [b.key, b]));

  return [...keys]
    .map((key) => {
      const p = prev.get(key)?.count ?? 0;
      const c = curr.get(key)?.count ?? 0;
      return {
        key,
        label: curr.get(key)?.label ?? prev.get(key)?.label ?? null,
        previous: p,
        current: c,
        change: c - p,
      };
    })
    // Largest movement first, in either direction — a drop from 7 to 3 is as
    // interesting as a rise from 2 to 5.
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.key.localeCompare(b.key));
}
