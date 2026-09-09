import { describe, it, expect } from 'vitest';
import { detectPatterns, detectTrend, DEFAULT_THRESHOLDS } from './patterns';
import type { ReportIncident } from './report';

/**
 * Pattern detection.
 *
 * The point of these tests is not that the counting works — it is that the
 * module cannot be made to state a cause it was not told. A pattern over a
 * customer, a product or a carrier must come out as `involvement` no matter
 * how many times it repeats, because repetition is not fault.
 */

const WINDOW = { from: '2026-07-01', to: '2026-09-30' };

/** A product on an incident. Unbranded unless a test says otherwise. */
const P = (
  id: string,
  name: string,
  code: string | null = null,
  brandId: string | null = null,
  brandName: string | null = null,
) => ({ id, name, code, brandId, brandName });

function inc(over: Partial<ReportIncident> = {}): ReportIncident {
  return {
    id: Math.random().toString(36).slice(2),
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
    products: [P('p1', 'Queso Oaxaca', '0200')],
    replacement_count: 0,
    ...over,
  };
}

const many = (n: number, over: Partial<ReportIncident> = {}) =>
  Array.from({ length: n }, () => inc(over));

const find = (incidents: ReportIncident[], dimension: string) =>
  detectPatterns(incidents, WINDOW).filter((p) => p.dimension === dimension);

describe('a repetition has to actually repeat', () => {
  it('two occurrences are not a pattern', () => {
    expect(find(many(2), 'incident_type')).toHaveLength(0);
  });

  it('three are', () => {
    const [p] = find(many(3), 'incident_type');
    expect(p).toMatchObject({ key: 'packaging_damaged', count: 3, outOf: 3 });
  });

  it('the threshold is configurable', () => {
    const patterns = detectPatterns(many(2), WINDOW, { minCount: 2, perDimension: 3 });
    expect(patterns.some((p) => p.dimension === 'incident_type')).toBe(true);
  });

  it('finds nothing in an empty period', () => {
    expect(detectPatterns([], WINDOW)).toEqual([]);
  });
});

describe('every pattern carries the evidence for it', () => {
  it('reports the count, the total and the window', () => {
    const [p] = find(many(6), 'incident_type');
    expect(p).toMatchObject({ count: 6, outOf: 6, from: '2026-07-01', to: '2026-09-30' });
  });

  it('the total is the whole period, so a share can be read honestly', () => {
    const incidents = [...many(4), ...many(6, { type_slug: 'late_delivery' })];
    const [p] = find(incidents, 'incident_type');
    // 6 of 10, not 6 of 6.
    expect(p.outOf).toBe(10);
  });
});

describe('association is never dressed up as fault', () => {
  it('a product repeating is INVOLVEMENT, however often it repeats', () => {
    const [p] = find(many(20), 'product');
    expect(p.kind).toBe('involvement');
    expect(p.count).toBe(20);
  });

  it('a customer repeating is involvement', () => {
    expect(find(many(9), 'customer')[0].kind).toBe('involvement');
  });

  it('a carrier repeating is involvement — never a finding', () => {
    const [p] = find(many(12), 'delivery_method');
    expect(p).toMatchObject({ kind: 'involvement', label: 'DHL', count: 12 });
  });

  it('NO dimension outside cause and responsibility can ever be a finding', () => {
    const incidents = many(15, { primary_cause: 'picking', responsibility: 'internal' });
    for (const p of detectPatterns(incidents, WINDOW)) {
      if (p.kind === 'finding') {
        expect(['primary_cause', 'responsibility']).toContain(p.dimension);
      }
    }
  });
});

describe('recorded findings', () => {
  it('a recorded primary cause IS a finding', () => {
    const [p] = find(many(5, { primary_cause: 'picking' }), 'primary_cause');
    expect(p).toMatchObject({ kind: 'finding', key: 'picking', count: 5 });
  });

  it('a recorded responsibility is a finding', () => {
    const [p] = find(many(4, { responsibility: 'transporter' }), 'responsibility');
    expect(p).toMatchObject({ kind: 'finding', key: 'transporter' });
  });

  it('UNINVESTIGATED incidents never become a responsibility finding', () => {
    // 'unknown' is the default for an incident nobody has looked at, so
    // reporting it would dress an absence of investigation as a conclusion.
    expect(find(many(10, { responsibility: 'unknown' }), 'responsibility')).toEqual([]);
  });

  it('an unrecorded cause is not a finding either', () => {
    expect(find(many(10, { primary_cause: null }), 'primary_cause')).toEqual([]);
  });
});

describe('counting per incident, not per row', () => {
  it('one incident naming a product three times counts once', () => {
    const incidents = many(3, {
      products: [
        P('p1', 'Oaxaca'),
        P('p1', 'Oaxaca'),
        P('p1', 'Oaxaca'),
      ],
    });
    expect(find(incidents, 'product')[0].count).toBe(3);
  });

  it('an incident with several products contributes to each', () => {
    const incidents = many(4, {
      products: [
        P('p1', 'Oaxaca'),
        P('p2', 'Panela'),
      ],
    });
    const products = find(incidents, 'product');
    expect(products).toHaveLength(2);
    expect(products.every((p) => p.count === 4)).toBe(true);
  });
});

describe('ordering and limits', () => {
  it('reports the strongest signal first', () => {
    const incidents = [
      ...many(3, { type_slug: 'late_delivery' }),
      ...many(8, { type_slug: 'packaging_damaged' }),
    ];
    const types = find(incidents, 'incident_type');
    expect(types.map((p) => p.count)).toEqual([8, 3]);
  });

  it('caps how many it reports per dimension', () => {
    const incidents = [
      ...many(5, { type_slug: 'a' }),
      ...many(4, { type_slug: 'b' }),
      ...many(3, { type_slug: 'c' }),
      ...many(3, { type_slug: 'd' }),
    ];
    expect(find(incidents, 'incident_type')).toHaveLength(DEFAULT_THRESHOLDS.perDimension);
  });

  it('is deterministic when counts tie', () => {
    const incidents = [...many(3, { type_slug: 'b' }), ...many(3, { type_slug: 'a' })];
    expect(find(incidents, 'incident_type').map((p) => p.key)).toEqual(['a', 'b']);
  });
});

describe('trends across periods', () => {
  const series = [
    { period: '2026-07', buckets: [{ key: 'transport', label: null, count: 2 }] },
    { period: '2026-08', buckets: [{ key: 'transport', label: null, count: 4 }] },
    { period: '2026-09', buckets: [{ key: 'transport', label: null, count: 5 }] },
  ];

  it('reports the series and the direction', () => {
    expect(detectTrend(series, 'transport')).toMatchObject({
      direction: 'up',
      change: 3,
      series: [
        { period: '2026-07', count: 2 },
        { period: '2026-08', count: 4 },
        { period: '2026-09', count: 5 },
      ],
    });
  });

  it('reads an absent period as zero rather than skipping it', () => {
    const withGap = [{ period: '2026-07', buckets: [] }, ...series.slice(1)];
    expect(detectTrend(withGap, 'transport')?.series[0]).toEqual({ period: '2026-07', count: 0 });
  });

  it('reports a decrease', () => {
    expect(detectTrend([...series].reverse(), 'transport')?.direction).toBe('down');
  });

  it('needs at least two periods to say anything', () => {
    expect(detectTrend(series.slice(0, 1), 'transport')).toBeNull();
  });
});
