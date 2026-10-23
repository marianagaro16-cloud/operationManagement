/**
 * What a production plan adds up to — the Excel's formulas, one place.
 *
 *   masa pura   = tortilla kg × pure share × (1 + waste) + masa kg
 *   grain kg    = masa pura ÷ masa per kg of grain;  sacks = ⌈grain ÷ sack kg⌉
 *   mixed masa  (lines that mix in flour) = tortilla kg × (1 + evaporation);
 *               flour, water and salt = mixed masa × their factor
 *   tortillas for totopos = (totopo + tostada kg) × totopo factor — to know,
 *               not part of the day's masa: totopos are fried from tortillas
 *               made on a Tortillas para freír day.
 *
 * The factors live on the line and are edited there.
 */

export type PlanSection = 'tortilla' | 'masa' | 'totopo' | 'tostada';
export const PLAN_SECTIONS: PlanSection[] = ['tortilla', 'masa', 'totopo', 'tostada'];

export interface LineFactors {
  pure_share: number;
  waste: number;
  masa_per_grain_kg: number;
  sack_kg: number;
  totopo_factor: number;
  evaporation: number | null;
  flour_factor: number | null;
  water_factor: number | null;
  salt_factor: number | null;
}

export interface PlanProduct {
  product_id: string;
  section: PlanSection;
  group_label: string;
  best_before_days: number | null;
  sort_order: number;
  /** kg of one unit; null when the product has no weight yet. */
  weight_kg: number | null;
}

export interface PlanRowQuantities {
  quantities: Record<string, number>;
}

export interface PlanTotals {
  /** Units per product, every row with the reserve. */
  units: Record<string, number>;
  kg: Record<PlanSection, number>;
  masaPura: number;
  grainKg: number;
  sacks: number;
  mixed: { masa: number; flour: number; water: number; salt: number } | null;
  tortillasForTotopos: number;
  /** Products with units but no weight: their kg are missing from the sums. */
  missingWeight: string[];
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

export function planTotals(products: PlanProduct[], rows: PlanRowQuantities[], f: LineFactors): PlanTotals {
  const units: Record<string, number> = {};
  for (const row of rows) {
    for (const [id, qty] of Object.entries(row.quantities)) {
      if (qty > 0) units[id] = (units[id] ?? 0) + qty;
    }
  }

  const kg: Record<PlanSection, number> = { tortilla: 0, masa: 0, totopo: 0, tostada: 0 };
  const missingWeight: string[] = [];
  for (const p of products) {
    const n = units[p.product_id] ?? 0;
    if (!n) continue;
    if (p.weight_kg == null) missingWeight.push(p.product_id);
    else kg[p.section] += n * p.weight_kg;
  }

  const masaPura = kg.tortilla * f.pure_share * (1 + f.waste) + kg.masa;
  const grainKg = f.masa_per_grain_kg > 0 ? masaPura / f.masa_per_grain_kg : 0;
  const sacks = f.sack_kg > 0 ? Math.ceil(round(grainKg / f.sack_kg, 6)) : 0;

  let mixed: PlanTotals['mixed'] = null;
  if (f.flour_factor != null) {
    const masa = kg.tortilla * (1 + (f.evaporation ?? 0));
    mixed = {
      masa: round(masa),
      flour: round(masa * f.flour_factor),
      water: round(masa * (f.water_factor ?? 0)),
      salt: round(masa * (f.salt_factor ?? 0), 3),
    };
  }

  return {
    units,
    kg: { tortilla: round(kg.tortilla), masa: round(kg.masa), totopo: round(kg.totopo), tostada: round(kg.tostada) },
    masaPura: round(masaPura),
    grainKg: round(grainKg),
    sacks,
    mixed,
    tortillasForTotopos: round((kg.totopo + kg.tostada) * f.totopo_factor),
    missingWeight,
  };
}

/** The lot of a production day, as the Excel writes it: day of the year and year — "294-2026". */
export function planLot(planDate: string): string {
  const [y, m, d] = planDate.split('-').map(Number);
  const day = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);
  return `${String(day).padStart(3, '0')}-${y}`;
}

/** Best-before of a product made that day. */
export function bestBefore(planDate: string, days: number | null): string | null {
  if (days == null) return null;
  const [y, m, d] = planDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The line's products in plan order, grouped under their heading, by section. */
export function groupProducts<T extends PlanProduct>(products: T[]): { section: PlanSection; groups: { label: string; products: T[] }[] }[] {
  const sorted = [...products].sort((a, b) => a.sort_order - b.sort_order);
  return PLAN_SECTIONS.map((section) => {
    const groups: { label: string; products: T[] }[] = [];
    for (const p of sorted.filter((x) => x.section === section)) {
      const last = groups.at(-1);
      if (last && last.label === p.group_label) last.products.push(p);
      else groups.push({ label: p.group_label, products: [p] });
    }
    return { section, groups };
  }).filter((s) => s.groups.length > 0);
}

/**
 * Orders' lines into plan rows: one row per customer and delivery day, the
 * units of the line's products summed. Orders without any of the line's
 * products give no row; orders already in the plan are left out.
 */
export interface OrderForPlan {
  id: string;
  customer_id: string;
  delivery_date: string;
  delivery_note: string | null;
  lines: { product_id: string; quantity: number }[];
}

export interface RowFromOrders {
  customer_id: string;
  delivery_date: string;
  delivery_note: string | null;
  order_ids: string[];
  quantities: Record<string, number>;
}

export function rowsFromOrders(orders: OrderForPlan[], lineProductIds: Set<string>, alreadyIn: Set<string>): RowFromOrders[] {
  const byKey = new Map<string, RowFromOrders>();
  for (const o of orders) {
    if (alreadyIn.has(o.id)) continue;
    const lines = o.lines.filter((l) => lineProductIds.has(l.product_id) && l.quantity > 0);
    if (!lines.length) continue;
    const key = `${o.customer_id}|${o.delivery_date}`;
    const row = byKey.get(key) ?? { customer_id: o.customer_id, delivery_date: o.delivery_date, delivery_note: o.delivery_note, order_ids: [], quantities: {} };
    row.order_ids.push(o.id);
    for (const l of lines) row.quantities[l.product_id] = (row.quantities[l.product_id] ?? 0) + l.quantity;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
}

/**
 * The lots a raw material can be taken from: those of the most recent
 * Materia Prima count where that material has a lot written (a count that
 * left the lot empty is skipped, not taken as "no lot"). Same lot counted twice
 * is one lot.
 */
export interface CountedLot {
  item_id: string;
  counted_on: string;
  lot: string | null;
  quantity: number | null;
}

export function latestLots(entries: CountedLot[]): Record<string, { lot: string; quantity: number; counted_on: string }[]> {
  const latest = new Map<string, string>();
  for (const e of entries) {
    if (!e.lot?.trim()) continue;
    const seen = latest.get(e.item_id);
    if (!seen || e.counted_on > seen) latest.set(e.item_id, e.counted_on);
  }
  const out: Record<string, { lot: string; quantity: number; counted_on: string }[]> = {};
  for (const e of entries) {
    const lot = e.lot?.trim();
    if (!lot || latest.get(e.item_id) !== e.counted_on) continue;
    const list = (out[e.item_id] ??= []);
    const same = list.find((x) => x.lot === lot);
    if (same) same.quantity += e.quantity ?? 0;
    else list.push({ lot, quantity: e.quantity ?? 0, counted_on: e.counted_on });
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.quantity - a.quantity);
  return out;
}

/** A plan's raw material lots to start from: each line material with its only lot, when it has just one. */
export interface MaterialLot {
  item_id: string | null;
  material: string;
  lot: string;
}

export function prefillLots(materials: { id: string; name: string }[], lots: Record<string, { lot: string }[]>): MaterialLot[] {
  return materials.map((m) => ({ item_id: m.id, material: m.name, lot: lots[m.id]?.length === 1 ? lots[m.id][0].lot : '' }));
}
