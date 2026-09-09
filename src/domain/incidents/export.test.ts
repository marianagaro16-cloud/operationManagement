import { describe, it, expect } from 'vitest';
import { incidentsToCsv, reportToCsv, type ExportableIncident } from './export';
import { buildReport, type ReportIncident } from './report';

/**
 * Exports.
 *
 * The file is the artefact that leaves the building — it goes into somebody's
 * spreadsheet, gets emailed, and outlives the screen it came from. So the two
 * things asserted here are that it opens correctly in a German/Swiss Excel
 * (the semicolon convention the rest of the app already uses) and that a value
 * containing a separator cannot break the column alignment.
 */

const row = (over: Partial<ExportableIncident> = {}): ExportableIncident => ({
  incident_number: 'INC-2026-0001',
  detected_at: '2026-09-05',
  status: 'open',
  severity: 'high',
  customer_name: 'Colectivo Anonimo GmbH',
  order_reference: 1042,
  category: 'packaging',
  type: 'packaging_damaged',
  products: '0200 Queso Oaxaca',
  affected_quantity: 4,
  primary_cause: 'packing',
  secondary_causes: 'transport',
  responsibility: 'internal',
  delivery_method: 'DHL',
  replacement_count: 1,
  corrective_action_count: 2,
  description: 'Box arrived crushed',
  resolved_at: null,
  closed_at: null,
  ...over,
});

describe('the incident list as a spreadsheet', () => {
  it('uses the semicolon convention the rest of the app uses', () => {
    const [header, line] = incidentsToCsv([row()]).split('\n');
    expect(header.split(';')[0]).toBe('incident');
    expect(line.split(';')[0]).toBe('INC-2026-0001');
  });

  it('writes a header even with no rows, so the file is still readable', () => {
    const csv = incidentsToCsv([]);
    expect(csv.split('\n')).toHaveLength(1);
    expect(csv).toContain('incident;detected;status');
  });

  it('every row has exactly as many fields as the header', () => {
    const lines = incidentsToCsv([row(), row({ customer_name: null, order_reference: null })]).split('\n');
    const width = lines[0].split(';').length;
    for (const line of lines) expect(line.split(';')).toHaveLength(width);
  });

  it('quotes a value containing the separator rather than breaking the row', () => {
    // A customer legitimately called "Müller; Sohn AG" must not shift every
    // column after it by one.
    const csv = incidentsToCsv([row({ customer_name: 'Müller; Sohn AG' })]);
    expect(csv).toContain('"Müller; Sohn AG"');
    expect(csv.split('\n')[1].split(';')).toHaveLength(csv.split('\n')[0].split(';').length + 1);
  });

  it('escapes an embedded quote by doubling it', () => {
    const csv = incidentsToCsv([row({ description: 'Marked "fragile" and still crushed' })]);
    expect(csv).toContain('"Marked ""fragile"" and still crushed"');
  });

  it('quotes a description containing a newline', () => {
    const csv = incidentsToCsv([row({ description: 'line one\nline two' })]);
    expect(csv).toContain('"line one\nline two"');
  });

  it('writes an empty field for a null rather than the word null', () => {
    const csv = incidentsToCsv([row({ customer_name: null, resolved_at: null })]);
    expect(csv).not.toContain('null');
    expect(csv.split('\n')[1]).toContain(';;');
  });

  it('exports stable slugs, so two languages stay joinable', () => {
    const csv = incidentsToCsv([row()]);
    expect(csv).toContain('packaging_damaged');
    expect(csv).not.toContain('Packaging damaged');
  });
});

describe('the monthly report as a spreadsheet', () => {
  const incident = (over: Partial<ReportIncident> = {}): ReportIncident => ({
    id: 'i1',
    incident_number: 'INC-2026-0001',
    detected_at: '2026-09-05T09:00:00.000Z',
    status: 'open',
    severity: 'high',
    primary_cause: 'packing',
    responsibility: 'internal',
    secondary_causes: [],
    customer_id: 'c1',
    customer_name: 'Colectivo Anonimo GmbH',
    order_id: 'o1',
    delivery_method_id: 'd1',
    delivery_method_name: 'DHL',
    category_slug: 'packaging',
    type_slug: 'packaging_damaged',
    products: [{ id: 'p1', name: 'Queso Oaxaca', code: '0200', brandId: 'b1', brandName: 'Masamor' }],
    replacement_count: 0,
    ...over,
  });

  const payload = buildReport({
    month: '2026-09',
    from: '2026-09-01',
    to: '2026-09-30',
    incidents: [incident(), incident({ id: 'i2' }), incident({ id: 'i3' })],
    actions: [],
    today: '2026-10-02',
  });

  // A stand-in for the dictionary lookup the route does.
  const translate = (section: string, key: string) => `${section}:${key}`;

  it('carries both the stable key and a readable label', () => {
    const csv = reportToCsv(payload, translate);
    expect(csv.split('\n')[0]).toBe('section;key;label;value');
    expect(csv).toContain('category;packaging;category:packaging;3');
  });

  it('includes the summary figures', () => {
    const csv = reportToCsv(payload, translate);
    expect(csv).toContain('summary;total;summary:total;3');
    expect(csv).toContain('summary;customersAffected;summary:customersAffected;1');
  });

  it('marks a pattern with its KIND, so the distinction survives the export', () => {
    // Once the colours and the hint text are gone, "involvement" versus
    // "finding" is the only thing left saying whether a number is an
    // association or a recorded conclusion.
    const csv = reportToCsv(payload, translate);
    const patterns = csv.split('\n').filter((l) => l.startsWith('pattern;'));
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.some((l) => l.includes('involvement'))).toBe(true);
    expect(patterns.some((l) => l.includes('finding'))).toBe(true);

    // A carrier can only ever appear as an involvement.
    const carrier = patterns.find((l) => l.includes('delivery_method'));
    expect(carrier).toContain('involvement');
  });

  it('uses the customer own name rather than asking for a translation', () => {
    const csv = reportToCsv(payload, translate);
    expect(csv).toContain('Colectivo Anonimo GmbH');
  });

  it('exports an empty month without producing a broken file', () => {
    const empty = buildReport({
      month: '2026-09', from: '2026-09-01', to: '2026-09-30',
      incidents: [], actions: [], today: '2026-10-02',
    });
    const lines = reportToCsv(empty, translate).split('\n');
    expect(lines[0]).toBe('section;key;label;value');
    // Only the summary and the action counts, all zero.
    expect(lines.every((l) => l.split(';').length === 4)).toBe(true);
  });
});
