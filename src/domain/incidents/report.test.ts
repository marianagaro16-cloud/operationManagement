import { describe, it, expect } from 'vitest';
import { buildReport, compareBuckets, summariseActions, type ReportAction, type ReportIncident } from './report';

/**
 * The monthly report.
 *
 * These tests are the guarantee behind every number a manager will act on, so
 * they assert the awkward cases rather than the happy one: an incident with
 * no order, an incident nobody has investigated, one product on three lines,
 * two incidents for one customer.
 *
 * The load-bearing assertion is the last block: association and recorded
 * findings stay in separate sections of the payload, and nothing in the
 * delivery-method section can be read as fault.
 */

const P = (id: string, name: string, code: string | null = null) => ({ id, name, code });

function inc(over: Partial<ReportIncident> = {}): ReportIncident {
  return {
    id: 'i1',
    incident_number: 'INC-2026-0001',
    detected_at: '2026-09-05T09:00:00.000Z',
    status: 'open',
    severity: 'medium',
    primary_cause: null,
    responsibility: 'unknown',
    secondary_causes: [],
    customer_id: 'c1',
    customer_name: 'Colectivo Anonimo GmbH',
    order_id: 'o1',
    delivery_method_id: 'd1',
    delivery_method_name: 'DHL',
    category_slug: 'packaging',
    type_slug: 'packaging_damaged',
    products: [P('p1', 'Queso Oaxaca 1kg', '0200')],
    replacement_count: 0,
    ...over,
  };
}

const PERIOD = { month: '2026-09', from: '2026-09-01', to: '2026-09-30', today: '2026-10-02' };
const build = (incidents: ReportIncident[], actions: ReportAction[] = []) =>
  buildReport({ ...PERIOD, incidents, actions });

describe('executive summary', () => {
  it('counts incidents, and counts the things behind them DISTINCTLY', () => {
    const r = build([
      inc({ id: 'a', order_id: 'o1', customer_id: 'c1' }),
      inc({ id: 'b', order_id: 'o1', customer_id: 'c1' }),
      inc({ id: 'c', order_id: 'o2', customer_id: 'c2' }),
    ]);
    // Three incidents, but two orders and two customers.
    expect(r.summary.total).toBe(3);
    expect(r.summary.ordersAffected).toBe(2);
    expect(r.summary.customersAffected).toBe(2);
  });

  it('does not count a missing order as an order', () => {
    const r = build([inc({ id: 'a', order_id: null }), inc({ id: 'b', order_id: null })]);
    expect(r.summary.ordersAffected).toBe(0);
    expect(r.summary.total).toBe(2);
  });

  it('counts distinct products across incidents', () => {
    const r = build([
      inc({ id: 'a', products: [P('p1', 'Oaxaca'), P('p2', 'Panela')] }),
      inc({ id: 'b', products: [P('p2', 'Panela')] }),
    ]);
    expect(r.summary.productsAffected).toBe(2);
  });

  it('splits the lifecycle and the serious severities', () => {
    const r = build([
      inc({ id: 'a', status: 'open' }),
      inc({ id: 'b', status: 'investigating' }),
      inc({ id: 'c', status: 'resolved' }),
      inc({ id: 'd', status: 'closed', severity: 'high' }),
      inc({ id: 'e', status: 'closed', severity: 'critical' }),
    ]);
    expect(r.summary).toMatchObject({ open: 2, resolved: 1, closed: 2, high: 1, critical: 1 });
  });

  it('sums replacements rather than counting incidents that have one', () => {
    const r = build([inc({ id: 'a', replacement_count: 2 }), inc({ id: 'b', replacement_count: 1 })]);
    expect(r.summary.replacements).toBe(3);
  });
});

describe('where are we failing', () => {
  it('groups by category and by type, most frequent first', () => {
    const r = build([
      inc({ id: 'a', category_slug: 'packaging', type_slug: 'packaging_damaged' }),
      inc({ id: 'b', category_slug: 'packaging', type_slug: 'packaging_damaged' }),
      inc({ id: 'c', category_slug: 'order_preparation', type_slug: 'missing_product' }),
    ]);
    expect(r.byCategory).toEqual([
      { key: 'packaging', label: null, count: 2 },
      { key: 'order_preparation', label: null, count: 1 },
    ]);
    expect(r.byType[0]).toMatchObject({ key: 'packaging_damaged', count: 2 });
  });

  it('leaves vocabulary labels null, so the dictionaries own the wording', () => {
    const r = build([inc()]);
    expect(r.byCategory[0].label).toBeNull();
    expect(r.bySeverity[0].label).toBeNull();
  });
});

describe('why — recorded findings only', () => {
  it('an uninvestigated incident is ABSENT from the cause breakdown', () => {
    // "We have not looked yet" and "we looked and cannot tell" are different
    // facts. Counting the first as 'unknown' would merge them.
    const r = build([inc({ id: 'a', primary_cause: null }), inc({ id: 'b', primary_cause: 'picking' })]);
    expect(r.byPrimaryCause).toEqual([{ key: 'picking', label: null, count: 1 }]);
  });

  it('counts an explicit unknown, which IS a conclusion', () => {
    const r = build([inc({ primary_cause: 'unknown' })]);
    expect(r.byPrimaryCause).toEqual([{ key: 'unknown', label: null, count: 1 }]);
  });

  it('counts each secondary cause once per incident', () => {
    const r = build([
      inc({ id: 'a', secondary_causes: ['packing', 'transport'] }),
      inc({ id: 'b', secondary_causes: ['transport'] }),
    ]);
    expect(r.bySecondaryCause).toEqual([
      { key: 'transport', label: null, count: 2 },
      { key: 'packing', label: null, count: 1 },
    ]);
  });

  it('secondary causes deliberately do not sum to the incident total', () => {
    const r = build([inc({ secondary_causes: ['packing', 'transport'] })]);
    expect(r.summary.total).toBe(1);
    expect(r.bySecondaryCause.reduce((n, b) => n + b.count, 0)).toBe(2);
  });
});

describe('who and what was involved', () => {
  it('names customers, because a customer has no translation', () => {
    const r = build([inc()]);
    expect(r.byCustomer).toEqual([
      { key: 'c1', label: 'Colectivo Anonimo GmbH', count: 1 },
    ]);
  });

  it('counts a product once per incident, not once per line', () => {
    const r = build([
      inc({ id: 'a', products: [P('p1', 'Oaxaca', '0200'), P('p1', 'Oaxaca', '0200')] }),
    ]);
    expect(r.byProduct).toEqual([{ key: 'p1', label: '0200 · Oaxaca', count: 1 }]);
  });

  it('works for any customer, with no customer hardcoded anywhere', () => {
    const r = build([
      inc({ id: 'a', customer_id: 'x', customer_name: 'Some Other AG' }),
      inc({ id: 'b', customer_id: 'x', customer_name: 'Some Other AG' }),
    ]);
    expect(r.byCustomer).toEqual([{ key: 'x', label: 'Some Other AG', count: 2 }]);
  });
});

describe('association is never presented as causation', () => {
  it('a carrier on five incidents appears ONLY as involvement', () => {
    const incidents = Array.from({ length: 5 }, (_, i) =>
      inc({ id: `i${i}`, delivery_method_id: 'dhl', delivery_method_name: 'DHL' }),
    );
    const r = build(incidents);

    // It is counted in the delivery-method section...
    expect(r.byDeliveryMethod).toEqual([{ key: 'dhl', label: 'DHL', count: 5 }]);
    // ...and nowhere near the responsibility findings, because nobody
    // recorded the transporter as responsible.
    expect(r.byResponsibility).toEqual([{ key: 'unknown', label: null, count: 5 }]);

    const carrierPatterns = r.patterns.filter((p) => p.dimension === 'delivery_method');
    expect(carrierPatterns).toHaveLength(1);
    expect(carrierPatterns[0].kind).toBe('involvement');
  });

  it('responsibility appears as a finding ONLY where it was recorded', () => {
    const incidents = Array.from({ length: 4 }, (_, i) =>
      inc({ id: `i${i}`, responsibility: 'transporter' }),
    );
    const r = build(incidents);
    const found = r.patterns.find((p) => p.dimension === 'responsibility');
    expect(found).toMatchObject({ kind: 'finding', key: 'transporter', count: 4 });
  });
});

describe('corrective actions', () => {
  const action = (over: Partial<ReportAction> = {}): ReportAction => ({
    occurrence_id: 'a1',
    incident_id: 'i1',
    due_date: '2026-09-15',
    status: 'pending',
    completed_at: null,
    ...over,
  });

  it('counts open, overdue, due in the period and completed', () => {
    const s = summariseActions(
      [
        action({ occurrence_id: '1', due_date: '2026-09-10', status: 'pending' }),
        action({ occurrence_id: '2', due_date: '2026-11-30', status: 'pending' }),
        action({ occurrence_id: '3', due_date: '2026-09-20', status: 'completed' }),
      ],
      '2026-09-01',
      '2026-09-30',
      '2026-10-02',
    );
    expect(s).toEqual({ total: 3, open: 2, overdue: 1, dueThisPeriod: 2, completed: 1 });
  });

  it('measures overdue against TODAY, not against the end of the period', () => {
    // An action due in September and still open in December is overdue now.
    // Reporting it as on-time "as of 30 September" would be useless.
    const s = summariseActions(
      [action({ due_date: '2026-09-15', status: 'pending' })],
      '2026-09-01',
      '2026-09-30',
      '2026-12-01',
    );
    expect(s.overdue).toBe(1);
  });

  it('a completed action is never overdue', () => {
    const s = summariseActions(
      [action({ due_date: '2026-01-01', status: 'completed' })],
      '2026-09-01',
      '2026-09-30',
      '2026-12-01',
    );
    expect(s.overdue).toBe(0);
  });
});

describe('the payload is a document', () => {
  it('carries its period and the incidents it was computed from', () => {
    const r = build([inc({ id: 'a' }), inc({ id: 'b' })]);
    expect(r.period).toEqual({ month: '2026-09', from: '2026-09-01', to: '2026-09-30' });
    expect(r.incidentIds).toEqual(['a', 'b']);
    expect(r.schema).toBe(1);
  });

  it('handles an empty month without inventing anything', () => {
    const r = build([]);
    expect(r.summary.total).toBe(0);
    expect(r.byCategory).toEqual([]);
    expect(r.patterns).toEqual([]);
    expect(r.incidentIds).toEqual([]);
  });

  it('is deterministic, so two people generate the same document', () => {
    const incidents = [inc({ id: 'a' }), inc({ id: 'b', category_slug: 'other', type_slug: 'other' })];
    expect(JSON.stringify(build(incidents))).toBe(JSON.stringify(build(incidents)));
  });
});

describe('comparing two months', () => {
  it('reports arithmetic and nothing more', () => {
    const august = [
      { key: 'packaging', label: null, count: 7 },
      { key: 'transport', label: null, count: 2 },
    ];
    const september = [
      { key: 'packaging', label: null, count: 3 },
      { key: 'transport', label: null, count: 5 },
    ];
    expect(compareBuckets(august, september)).toEqual([
      { key: 'packaging', label: null, previous: 7, current: 3, change: -4 },
      { key: 'transport', label: null, previous: 2, current: 5, change: 3 },
    ]);
  });

  it('includes a category that appeared for the first time', () => {
    const d = compareBuckets([], [{ key: 'cold_chain_issue', label: null, count: 4 }]);
    expect(d).toEqual([
      { key: 'cold_chain_issue', label: null, previous: 0, current: 4, change: 4 },
    ]);
  });

  it('includes a category that stopped happening, rather than hiding it', () => {
    const d = compareBuckets([{ key: 'packaging', label: null, count: 6 }], []);
    expect(d[0]).toMatchObject({ previous: 6, current: 0, change: -6 });
  });
});
