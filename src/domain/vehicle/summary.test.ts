import { describe, expect, it } from 'vitest';
import { formatMinutes, summarizeByMonth, tripKm, tripMinutes } from './summary';

const trip = (date: string, out: string, back: string | null, kmOut: number, kmBack: number | null) => ({
  trip_date: date,
  left_at: `${date}T${out}:00+02:00`,
  returned_at: back ? `${date}T${back}:00+02:00` : null,
  left_km: kmOut,
  returned_km: kmBack,
});

describe('a round', () => {
  it('measures time and km once back', () => {
    const t = trip('2026-10-20', '09:10', '12:40', 1000, 1063);
    expect(tripMinutes(t)).toBe(210);
    expect(tripKm(t)).toBe(63);
  });

  it('measures nothing while out', () => {
    const t = trip('2026-10-20', '09:10', null, 1000, null);
    expect(tripMinutes(t)).toBeNull();
    expect(tripKm(t)).toBeNull();
  });

  it('writes durations the way people say them', () => {
    expect(formatMinutes(210)).toBe('3 h 30');
    expect(formatMinutes(65)).toBe('1 h 05');
    expect(formatMinutes(40)).toBe('40 min');
  });
});

describe('summarizeByMonth', () => {
  const trips = [
    trip('2026-10-20', '09:00', '12:00', 1000, 1060),
    trip('2026-10-22', '09:00', '11:00', 1060, 1100),
    trip('2026-10-23', '09:00', null, 1100, null),
    trip('2026-09-30', '08:00', '10:00', 900, 1000),
  ];
  const costs = [
    { kind: 'fuel' as const, spent_on: '2026-10-21', amount: '90.00', litres: '50' },
    { kind: 'parking' as const, spent_on: '2026-10-20', amount: 5, litres: null },
    { kind: 'insurance' as const, spent_on: '2026-10-01', amount: 1200, litres: null },
    { kind: 'washing' as const, spent_on: '2026-10-15', amount: 25, litres: null },
  ];
  const repairs = [
    { fixed_on: '2026-10-10', cost: '180' },
    { fixed_on: '2026-10-11', cost: null },
  ];

  it('adds up a month, newest first', () => {
    const [oct, sep] = summarizeByMonth(trips, costs, repairs);
    expect(oct).toMatchObject({
      month: '2026-10', rounds: 2, minutes: 300, avgMinutes: 150, km: 100, avgKm: 50,
      fuel: 90, litres: 50, litresPer100: 50, road: 5, fixed: 1200, other: 25, repairs: 180, total: 1500, perKm: 15,
    });
    expect(sep).toMatchObject({ month: '2026-09', rounds: 1, km: 100, total: 0, perKm: 0, litresPer100: null });
  });

  it('a round still out counts nowhere yet', () => {
    expect(summarizeByMonth([trip('2026-10-23', '09:00', null, 1, null)], [], [])).toEqual([]);
  });
});
