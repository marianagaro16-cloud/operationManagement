import { describe, expect, it } from 'vitest';
import { lotAllocationsToCsv, type ExportableLotRow } from './lot-export';

const row = (over: Partial<ExportableLotRow> = {}): ExportableLotRow => ({
  lot_number: 'LOT-260906-A',
  product_name: 'Bio Mais Tortillas 14cm',
  product_code: '0073',
  customer_name: 'La Catedral',
  customer_addition: null,
  order_reference: 10452,
  quantity: 12,
  preparation_date: '2026-09-09',
  delivery_date: '2026-09-09',
  entered_by: 'User A',
  modified_by: 'User A',
  updated_at: '2026-09-09T14:22:31.000Z',
  ...over,
});

describe('lotAllocationsToCsv', () => {
  it('writes a header even with no rows, so the file is still openable', () => {
    const csv = lotAllocationsToCsv([]);
    expect(csv.split('\n')).toHaveLength(1);
    expect(csv).toContain('lot;product;product_code');
  });

  it('writes one line per allocation', () => {
    const csv = lotAllocationsToCsv([row(), row({ order_reference: 10461 })]);
    expect(csv.split('\n')).toHaveLength(3); // header + 2
  });

  it('carries the traceability fields', () => {
    const csv = lotAllocationsToCsv([row()]);
    const line = csv.split('\n')[1];
    expect(line).toContain('LOT-260906-A');
    expect(line).toContain('0073');
    expect(line).toContain('La Catedral');
    expect(line).toContain('#10452');
    expect(line).toContain('12');
    expect(line).toContain('User A');
  });

  it('prefixes the order with # as the app shows it', () => {
    expect(lotAllocationsToCsv([row()])).toContain('#10452');
  });

  it('shortens the modified timestamp to a date a spreadsheet can read', () => {
    const line = lotAllocationsToCsv([row()]).split('\n')[1];
    expect(line).toContain('2026-09-09');
    expect(line).not.toContain('14:22:31');
  });

  it('leaves a missing code or addition empty rather than writing null', () => {
    const line = lotAllocationsToCsv([
      row({ product_code: null, customer_addition: null, entered_by: null }),
    ]).split('\n')[1];
    expect(line).not.toContain('null');
    expect(line.split(';')[2]).toBe('');
  });

  // Semicolon-separated, so a customer name containing one would otherwise
  // silently shift every later column.
  it('quotes a value containing the separator', () => {
    const line = lotAllocationsToCsv([row({ customer_name: 'Meier; Sohn' })]).split('\n')[1];
    expect(line).toContain('"Meier; Sohn"');
  });

  it('escapes an embedded quote by doubling it', () => {
    const line = lotAllocationsToCsv([row({ product_name: 'Tortillas 14" round' })]).split('\n')[1];
    expect(line).toContain('"Tortillas 14"" round"');
  });

  it('quotes a value containing a newline', () => {
    const line = lotAllocationsToCsv([row({ customer_name: 'Two\nLines' })]);
    expect(line).toContain('"Two\nLines"');
  });

  it('exports exactly the rows given and never more', () => {
    const only = lotAllocationsToCsv([row({ lot_number: 'LOT-A' })]);
    expect(only).toContain('LOT-A');
    expect(only).not.toContain('LOT-B');
  });
});
