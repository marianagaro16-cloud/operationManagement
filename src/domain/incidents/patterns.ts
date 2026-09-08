import type { ReportIncident } from './report';

/**
 * Deterministic pattern detection.
 *
 * No model, no scoring, no inference — §40 rules all three out for this
 * version. A pattern here is nothing more than "this value occurred at least
 * N times in this window", and every one it emits carries the count and the
 * window so a reader can check it.
 *
 * THE DISTINCTION THIS FILE EXISTS TO PROTECT:
 *
 *   `kind: 'involvement'`  — the value was PRESENT on N incidents. A join.
 *                            Says nothing about fault. Customers, products
 *                            and delivery methods are only ever this.
 *
 *   `kind: 'finding'`      — somebody investigated and RECORDED this value as
 *                            the cause or the responsibility. A judgement,
 *                            already made by a person, that the report is
 *                            merely counting.
 *
 * The UI picks its wording from `kind`, so "Product X was involved in 6
 * incidents" and "Picking was recorded as the primary cause of 6 incidents"
 * cannot be swapped by a translation edit. A pattern over a customer or a
 * carrier can never be emitted as a finding, because this file never
 * constructs one.
 */

export type PatternKind = 'involvement' | 'finding';

export type PatternDimension =
  | 'incident_type'
  | 'category'
  | 'customer'
  | 'product'
  | 'delivery_method'
  | 'primary_cause'
  | 'responsibility';

export interface Pattern {
  dimension: PatternDimension;
  kind: PatternKind;
  /** Stable identifier: a slug for vocabulary, a uuid for a record. */
  key: string;
  /** Display name for a record; null for vocabulary the dictionaries own. */
  label: string | null;
  count: number;
  /** Out of how many incidents in the window — so a share can be shown honestly. */
  outOf: number;
  from: string;
  to: string;
}

export interface PatternThresholds {
  /**
   * How many occurrences make a repetition worth reporting.
   *
   * Three, because two is a coincidence often enough that reporting it would
   * fill the section with noise and teach people to skip it. Configurable
   * because the right number depends on how many orders a month carries.
   */
  minCount: number;
  /** How many patterns to report per dimension, strongest first. */
  perDimension: number;
}

export const DEFAULT_THRESHOLDS: PatternThresholds = { minCount: 3, perDimension: 3 };

interface Occurrence {
  key: string;
  label: string | null;
}

function count(
  incidents: ReportIncident[],
  extract: (i: ReportIncident) => Occurrence[] | Occurrence | null,
): Map<string, Occurrence & { count: number }> {
  const counts = new Map<string, Occurrence & { count: number }>();
  for (const incident of incidents) {
    const got = extract(incident);
    if (!got) continue;
    const list = Array.isArray(got) ? got : [got];
    // De-duplicated per incident: one incident naming a product on three
    // lines is one incident involving that product, not three.
    const seen = new Set<string>();
    for (const occurrence of list) {
      if (seen.has(occurrence.key)) continue;
      seen.add(occurrence.key);
      const existing = counts.get(occurrence.key);
      if (existing) existing.count++;
      else counts.set(occurrence.key, { ...occurrence, count: 1 });
    }
  }
  return counts;
}

export function detectPatterns(
  incidents: ReportIncident[],
  window: { from: string; to: string },
  thresholds: PatternThresholds = DEFAULT_THRESHOLDS,
): Pattern[] {
  const total = incidents.length;
  if (total === 0) return [];

  const dimensions: {
    dimension: PatternDimension;
    kind: PatternKind;
    extract: (i: ReportIncident) => Occurrence[] | Occurrence | null;
  }[] = [
    // ---- what keeps happening: association ----
    {
      dimension: 'incident_type',
      kind: 'involvement',
      extract: (i) => ({ key: i.type_slug, label: null }),
    },
    {
      dimension: 'category',
      kind: 'involvement',
      extract: (i) => ({ key: i.category_slug, label: null }),
    },
    {
      dimension: 'customer',
      kind: 'involvement',
      extract: (i) => (i.customer_id ? { key: i.customer_id, label: i.customer_name } : null),
    },
    {
      dimension: 'product',
      kind: 'involvement',
      extract: (i) =>
        i.products.map((p) => ({
          key: p.id,
          label: p.code ? `${p.code} · ${p.name}` : p.name,
        })),
    },
    {
      // Association only, always. A carrier appearing on five incidents is
      // five deliveries that went wrong, not five failures by the carrier —
      // the responsibility dimension below is the only place fault is stated.
      dimension: 'delivery_method',
      kind: 'involvement',
      extract: (i) =>
        i.delivery_method_id
          ? { key: i.delivery_method_id, label: i.delivery_method_name }
          : null,
    },

    // ---- what was actually concluded: recorded findings ----
    {
      dimension: 'primary_cause',
      kind: 'finding',
      extract: (i) => (i.primary_cause ? { key: i.primary_cause, label: null } : null),
    },
    {
      dimension: 'responsibility',
      kind: 'finding',
      // 'unknown' is the default for an incident nobody has investigated, so
      // reporting "unknown was recorded 8 times" as a finding would dress up
      // an absence of investigation as a conclusion.
      extract: (i) =>
        i.responsibility === 'unknown' ? null : { key: i.responsibility, label: null },
    },
  ];

  const patterns: Pattern[] = [];
  for (const { dimension, kind, extract } of dimensions) {
    const counted = [...count(incidents, extract).values()]
      .filter((c) => c.count >= thresholds.minCount)
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, thresholds.perDimension);

    for (const c of counted) {
      patterns.push({
        dimension,
        kind,
        key: c.key,
        label: c.label,
        count: c.count,
        outOf: total,
        from: window.from,
        to: window.to,
      });
    }
  }

  // Strongest signal first across every dimension, so the section opens with
  // the thing most worth looking at.
  return patterns.sort(
    (a, b) => b.count - a.count || a.dimension.localeCompare(b.dimension) || a.key.localeCompare(b.key),
  );
}

/**
 * A trend across several consecutive periods.
 *
 * Used for "transport-related incidents increased over the last three
 * months". Reports the series and the direction and stops there — it does not
 * test significance, and with the handful of incidents a month this operation
 * produces, any claim of significance would be false precision.
 */
export interface Trend {
  key: string;
  label: string | null;
  /** Oldest period first. */
  series: { period: string; count: number }[];
  direction: 'up' | 'down' | 'flat';
  change: number;
}

export function detectTrend(
  series: { period: string; buckets: { key: string; label: string | null; count: number }[] }[],
  key: string,
): Trend | null {
  if (series.length < 2) return null;

  const points = series.map((s) => ({
    period: s.period,
    count: s.buckets.find((b) => b.key === key)?.count ?? 0,
  }));
  const label = series.flatMap((s) => s.buckets).find((b) => b.key === key)?.label ?? null;

  const change = points[points.length - 1].count - points[0].count;
  return {
    key,
    label,
    series: points,
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    change,
  };
}
