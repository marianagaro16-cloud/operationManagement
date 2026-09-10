import { describe, it, expect } from 'vitest';
import {
  buildReceptionReport,
  detectReceptionPatterns,
  MIN_RECEPTIONS_FOR_RATE,
  UNRECORDED_KEY,
  type ReportReception,
} from './report';

/**
 * The monthly reception report.
 *
 * The tests that matter here are the ones about what the report REFUSES to
 * say: no attribution of blame, no rate computed off a denominator too small
 * to mean anything, and no silent disappearance of rows whose supplier was
 * never recorded.
 */

let seq = 0;
const reception = (over: Partial<ReportReception> = {}): ReportReception => {
  seq += 1;
  return {
    id: `r-${seq}`,
    reception_number: `GR-2026-${String(seq).padStart(4, '0')}`,
    received_at: `2026-09-${String((seq % 28) + 1).padStart(2, '0')}T08:00:00Z`,
    status: 'completed',
    condition: 'good',
    quantity_check: 'checked_ok',
    supplier_id: 'sup-1',
    supplier_name: 'Pacovis',
    transporter_id: 'tra-1',
    transporter_name: 'DHL',
    received_by: 'user-1',
    received_by_name: 'Mariana',
    incident_count: 0,
    exception_count: 0,
    ...over,
  };
};

const build = (receptions: ReportReception[]) =>
  buildReceptionReport({ period: '2026-09', receptions, unrecordedLabel: 'Not recorded' });

describe('summary', () => {
  it('counts an empty month without dividing by zero', () => {
    const report = build([]);
    expect(report.summary.total).toBe(0);
    expect(report.suppliers).toEqual([]);
    expect(report.openReceptions).toEqual([]);
  });

  it('separates receptions-with-incidents from the incident total', () => {
    // One delivery with three problems is ONE reception and THREE incidents.
    // §23 requires both numbers to survive; collapsing them would make a bad
    // day look like a bad month.
    const report = build([
      reception({ incident_count: 3 }),
      reception({ incident_count: 1 }),
      reception(),
    ]);
    expect(report.summary.withIncidents).toBe(2);
    expect(report.summary.incidents).toBe(4);
  });

  it('counts unchecked deliveries separately from clean ones', () => {
    const report = build([
      reception({ quantity_check: 'not_checked' }),
      reception({ quantity_check: 'checked_ok' }),
      reception({ quantity_check: 'discrepancy', comments: 'x' } as Partial<ReportReception>),
    ]);
    expect(report.summary.notChecked).toBe(1);
    expect(report.summary.withDiscrepancy).toBe(1);
  });

  it('treats every non-good condition as a problem', () => {
    const report = build([
      reception({ condition: 'good' }),
      reception({ condition: 'damaged' }),
      reception({ condition: 'partially_damaged' }),
      reception({ condition: 'other_issue' }),
      reception({ condition: null }),
    ]);
    expect(report.summary.withConditionProblem).toBe(3);
  });

  it('omits an unrecorded condition rather than counting it as good', () => {
    const report = build([reception({ condition: null }), reception({ condition: 'good' })]);
    expect(report.byCondition).toEqual([{ key: 'good', label: 'good', count: 1 }]);
  });
});

describe('supplier and transporter performance', () => {
  it('counts receptions per party without attributing blame', () => {
    const report = build([
      reception({ supplier_id: 'a', supplier_name: 'Pacovis', incident_count: 1 }),
      reception({ supplier_id: 'a', supplier_name: 'Pacovis' }),
      reception({ supplier_id: 'b', supplier_name: 'Stofel' }),
    ]);

    const pacovis = report.suppliers.find((s) => s.id === 'a')!;
    expect(pacovis.receptions).toBe(2);
    expect(pacovis.withIncidents).toBe(1);
    // The payload has no field that could express "caused". Naming is the
    // guardrail — see the header of report.ts.
    expect(Object.keys(pacovis)).not.toContain('causedIncidents');
  });

  it('withholds a rate when there are too few deliveries to mean anything', () => {
    const report = build([
      reception({ supplier_id: 'a', supplier_name: 'Small', incident_count: 1 }),
      reception({ supplier_id: 'a', supplier_name: 'Small' }),
    ]);
    // 50% off two deliveries is a number that misleads more than it informs.
    expect(report.suppliers[0].incidentRate).toBeNull();
  });

  it('computes a rate once the denominator is reliable', () => {
    const rows = Array.from({ length: MIN_RECEPTIONS_FOR_RATE }, (_, i) =>
      reception({ supplier_id: 'a', supplier_name: 'Big', incident_count: i === 0 ? 1 : 0 }),
    );
    const report = build(rows);
    expect(report.suppliers[0].incidentRate).toBeCloseTo(1 / MIN_RECEPTIONS_FOR_RATE);
  });

  it('gives deliveries with no supplier their own visible bucket', () => {
    // Dropping them would make the supplier counts add up to less than the
    // total with no explanation on screen.
    const report = build([reception({ supplier_id: null, supplier_name: null }), reception()]);
    const unrecorded = report.suppliers.find((s) => s.id === UNRECORDED_KEY);
    expect(unrecorded).toBeDefined();
    expect(unrecorded!.name).toBe('Not recorded');
    expect(report.suppliers.reduce((n, s) => n + s.receptions, 0)).toBe(report.summary.total);
  });

  it('keeps transporter figures independent of supplier figures', () => {
    const report = build([
      reception({ supplier_id: 'a', supplier_name: 'A', transporter_id: 't1', transporter_name: 'DHL', incident_count: 1 }),
      reception({ supplier_id: 'b', supplier_name: 'B', transporter_id: 't1', transporter_name: 'DHL' }),
    ]);
    const dhl = report.transporters.find((t) => t.id === 't1')!;
    expect(dhl.receptions).toBe(2);
    expect(dhl.withIncidents).toBe(1);
    expect(report.suppliers).toHaveLength(2);
  });
});

describe('open receptions', () => {
  it('lists what is still not completed, oldest first', () => {
    const report = build([
      reception({ status: 'completed' }),
      reception({ status: 'draft', received_at: '2026-09-20T08:00:00Z' }),
      reception({ status: 'checking', received_at: '2026-09-02T08:00:00Z' }),
    ]);
    expect(report.summary.open).toBe(2);
    expect(report.openReceptions.map((r) => r.status)).toEqual(['checking', 'draft']);
  });
});

describe('pattern detection', () => {
  it('reports a repeated problem as a count, never as a cause', () => {
    const rows = Array.from({ length: 3 }, () =>
      reception({ supplier_id: 'a', supplier_name: 'Pacovis', incident_count: 1 }),
    );
    const patterns = detectReceptionPatterns(build(rows));
    expect(patterns).toContainEqual({
      kind: 'supplier_incidents',
      key: 'a',
      label: 'Pacovis',
      count: 3,
    });
  });

  it('says nothing below the threshold', () => {
    const rows = Array.from({ length: 2 }, () =>
      reception({ supplier_id: 'a', supplier_name: 'Pacovis', incident_count: 1 }),
    );
    expect(detectReceptionPatterns(build(rows))).toEqual([]);
  });

  it('is deterministic — the same rows give the same answer', () => {
    const rows = Array.from({ length: 4 }, () =>
      reception({ supplier_id: 'a', supplier_name: 'Pacovis', quantity_check: 'discrepancy' }),
    );
    const once = detectReceptionPatterns(build(rows));
    const twice = detectReceptionPatterns(build(rows));
    expect(once).toEqual(twice);
  });
});
