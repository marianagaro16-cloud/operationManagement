/*
 * The Palomo's rounds and costs (2026-10-23), and what they add up to per
 * month: the figures other routes will be planned from — how long a round
 * takes, how far it goes, what a km costs.
 */

export const COST_KINDS = ['fuel', 'parking', 'toll', 'fine', 'insurance', 'tax', 'vignette', 'washing', 'other'] as const;
export type CostKind = (typeof COST_KINDS)[number];

/** What the driver pays on the road and enters from the phone; the office enters the rest. */
export const DRIVER_COST_KINDS: readonly CostKind[] = ['fuel', 'parking', 'toll', 'fine'];

const ROAD: readonly CostKind[] = ['parking', 'toll', 'fine'];
const FIXED: readonly CostKind[] = ['insurance', 'tax', 'vignette'];

export interface TripTimes {
  trip_date: string;
  left_at: string;
  left_km: number;
  returned_at: string | null;
  returned_km: number | null;
}

export interface CostAmount {
  kind: CostKind;
  spent_on: string;
  /** numeric: may arrive as a string. */
  amount: number | string;
  litres: number | string | null;
}

export interface RepairCost {
  /** The day it was fixed, Europe/Zurich. */
  fixed_on: string;
  cost: number | string | null;
}

/** Minutes out, or null while the round is not back. */
export function tripMinutes(t: Pick<TripTimes, 'left_at' | 'returned_at'>): number | null {
  if (!t.returned_at) return null;
  return Math.round((new Date(t.returned_at).getTime() - new Date(t.left_at).getTime()) / 60000);
}

/** Km driven, or null while the round is not back. */
export function tripKm(t: Pick<TripTimes, 'left_km' | 'returned_km'>): number | null {
  return t.returned_km === null ? null : t.returned_km - t.left_km;
}

/** "2 h 05" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

export interface MonthSummary {
  /** YYYY-MM */
  month: string;
  /** Rounds that came back; one still out counts nowhere yet. */
  rounds: number;
  minutes: number;
  avgMinutes: number | null;
  km: number;
  avgKm: number | null;
  fuel: number;
  litres: number;
  /** Litres per 100 km, from the fuel bought and the km driven that month. */
  litresPer100: number | null;
  /** Parking, tolls, fines. */
  road: number;
  /** Insurance, tax, vignette: counted in the month they were paid. */
  fixed: number;
  /** Washing and anything else. */
  other: number;
  /** Repairs from Mantenimiento, by the day they were fixed. */
  repairs: number;
  total: number;
  perKm: number | null;
}

const num = (v: number | string | null) => (v === null || v === '' ? 0 : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Month by month, newest first. Only months with something in them. */
export function summarizeByMonth(trips: TripTimes[], costs: CostAmount[], repairs: RepairCost[]): MonthSummary[] {
  const months = new Map<string, MonthSummary>();
  const at = (month: string) => {
    let row = months.get(month);
    if (!row) {
      row = { month, rounds: 0, minutes: 0, avgMinutes: null, km: 0, avgKm: null, fuel: 0, litres: 0, litresPer100: null, road: 0, fixed: 0, other: 0, repairs: 0, total: 0, perKm: null };
      months.set(month, row);
    }
    return row;
  };

  for (const t of trips) {
    const minutes = tripMinutes(t);
    const km = tripKm(t);
    if (minutes === null || km === null) continue;
    const row = at(t.trip_date.slice(0, 7));
    row.rounds++;
    row.minutes += minutes;
    row.km += km;
  }
  for (const c of costs) {
    const row = at(c.spent_on.slice(0, 7));
    const amount = num(c.amount);
    if (c.kind === 'fuel') {
      row.fuel += amount;
      row.litres += num(c.litres);
    } else if (ROAD.includes(c.kind)) row.road += amount;
    else if (FIXED.includes(c.kind)) row.fixed += amount;
    else row.other += amount;
  }
  for (const r of repairs) {
    if (r.cost === null) continue;
    at(r.fixed_on.slice(0, 7)).repairs += num(r.cost);
  }

  return [...months.values()]
    .map((r) => {
      const total = round2(r.fuel + r.road + r.fixed + r.other + r.repairs);
      return {
        ...r,
        fuel: round2(r.fuel),
        litres: round2(r.litres),
        road: round2(r.road),
        fixed: round2(r.fixed),
        other: round2(r.other),
        repairs: round2(r.repairs),
        total,
        avgMinutes: r.rounds > 0 ? Math.round(r.minutes / r.rounds) : null,
        avgKm: r.rounds > 0 ? Math.round(r.km / r.rounds) : null,
        litresPer100: r.km > 0 && r.litres > 0 ? Math.round((r.litres / r.km) * 1000) / 10 : null,
        perKm: r.km > 0 ? round2(total / r.km) : null,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** Where receipt photos go: <uploader's id>/<file>. */
export const RECEIPT_BUCKET = 'vehicle-receipts';
