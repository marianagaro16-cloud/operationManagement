import { describe, expect, it } from 'vitest';
import { changePct, salesReportToCsv } from './report';

describe('changePct', () => {
  it('rounds to whole percent', () => {
    expect(changePct(120, 100)).toBe(20);
    expect(changePct(70, 100)).toBe(-30);
    expect(changePct(1, 3)).toBe(-67);
  });

  it('has no change without a period before', () => {
    expect(changePct(50, 0)).toBeNull();
  });

  it('reads numbers that come as strings', () => {
    expect(changePct('15' as unknown as number, '10' as unknown as number)).toBe(50);
  });
});

describe('salesReportToCsv', () => {
  it('writes a header and one row per line, semicolon-separated', () => {
    const csv = salesReportToCsv(
      [
        { id: '1', name: 'El Mini Super', detail: 'Zürich', quantity: 340, kg: 137, prev_quantity: 200, prev_kg: 90 },
        { id: '2', name: 'Nuevo; S.A.', detail: null, quantity: 10, kg: 5, prev_quantity: 0, prev_kg: 0 },
      ],
      { name: 'customer', detail: 'city' },
    );
    expect(csv.split('\n')).toEqual([
      'customer;city;units;kg;units_before;kg_before;change_units_pct',
      'El Mini Super;Zürich;340;137;200;90;70',
      '"Nuevo; S.A.";;10;5;0;0;',
    ]);
  });

  it('leaves out the second column when there is none', () => {
    expect(salesReportToCsv([], { name: 'type' })).toBe('type;units;kg;units_before;kg_before;change_units_pct');
  });
});
