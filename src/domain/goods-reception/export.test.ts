import { describe, it, expect } from 'vitest';
import { receptionReportToCsv, receptionsToCsv, type ExportableReception } from './export';
import { buildReceptionReport, type ReportReception } from './report';

const row = (over: Partial<ExportableReception> = {}): ExportableReception => ({
  reception_number: 'GR-2026-0001',
  received_at: '2026-09-10T08:35:00Z',
  status: 'completed',
  supplier: 'Käserei Stofel',
  transporter: 'DHL',
  delivery_note: '4004919',
  received_by: 'Mariana',
  condition: 'good',
  quantity_check: 'checked_ok',
  exception_count: 0,
  incident_count: 0,
  comments: null,
  ...over,
});

describe('reception list export', () => {
  it('writes a header and one semicolon-separated line per reception', () => {
    const csv = receptionsToCsv([row()]);
    const [header, first] = csv.split('\n');
    expect(header.split(';')[0]).toBe('reception');
    expect(first).toContain('GR-2026-0001');
    expect(first).toContain('Käserei Stofel');
  });

  it('quotes a comment containing the separator', () => {
    // A free-text comment is exactly where a semicolon turns up, and an
    // unquoted one would shift every later column by a cell.
    const csv = receptionsToCsv([row({ comments: 'late; driver reported damage' })]);
    expect(csv).toContain('"late; driver reported damage"');
  });

  it('doubles an embedded quote rather than truncating the field', () => {
    const csv = receptionsToCsv([row({ comments: 'pallet marked "fragile"' })]);
    expect(csv).toContain('"pallet marked ""fragile"""');
  });

  it('writes an empty cell for an absent transporter', () => {
    const csv = receptionsToCsv([row({ transporter: null })]);
    expect(csv.split('\n')[1]).toContain(';;');
  });
});

describe('monthly report export', () => {
  const reception = (over: Partial<ReportReception> = {}): ReportReception => ({
    id: 'r1',
    reception_number: 'GR-2026-0001',
    received_at: '2026-09-10T08:35:00Z',
    status: 'completed',
    condition: 'good',
    quantity_check: 'checked_ok',
    supplier_id: 'sup-1',
    supplier_name: 'Pacovis',
    transporter_id: 'tra-1',
    transporter_name: 'DHL',
    received_by: 'u1',
    received_by_name: 'Mariana',
    incident_count: 0,
    exception_count: 0,
    ...over,
  });

  it('carries the period and the totals', () => {
    const payload = buildReceptionReport({
      period: '2026-09',
      receptions: [reception()],
      unrecordedLabel: 'Not recorded',
    });
    const csv = receptionReportToCsv(payload);
    expect(csv).toContain('2026-09');
    expect(csv).toContain('total;1');
  });

  it('leaves the rate cell EMPTY when the denominator was too small', () => {
    // §40: a blank is honest. "0.0" would read as a measured zero.
    const payload = buildReceptionReport({
      period: '2026-09',
      receptions: [reception()],
      unrecordedLabel: 'Not recorded',
    });
    const supplierLine = receptionReportToCsv(payload)
      .split('\n')
      .find((l) => l.startsWith('Pacovis'))!;
    expect(supplierLine.endsWith(';')).toBe(true);
  });

  it('writes a rate once there are enough deliveries', () => {
    const receptions = Array.from({ length: 5 }, (_, i) =>
      reception({ id: `r${i}`, incident_count: i === 0 ? 1 : 0 }),
    );
    const payload = buildReceptionReport({
      period: '2026-09',
      receptions,
      unrecordedLabel: 'Not recorded',
    });
    const supplierLine = receptionReportToCsv(payload)
      .split('\n')
      .find((l) => l.startsWith('Pacovis'))!;
    expect(supplierLine.endsWith(';20.0')).toBe(true);
  });

  it('keeps supplier and transporter as separate sections', () => {
    const payload = buildReceptionReport({
      period: '2026-09',
      receptions: [reception()],
      unrecordedLabel: 'Not recorded',
    });
    const csv = receptionReportToCsv(payload);
    expect(csv).toContain('supplier;receptions;');
    expect(csv).toContain('transporter;receptions;');
  });
});
