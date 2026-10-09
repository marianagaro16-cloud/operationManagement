/**
 * The weekly work schedule's rules — pure, so the grid, the PDF and the
 * warnings all read the same numbers, and the numbers are tested.
 *
 * A week runs Sunday (day 0) to Saturday (day 6). A person has up to two
 * blocks a day. A block without a kind is production; a kind that does not
 * count hours (Vacaciones, Libre, Enfermedad) is a day off.
 */

export interface Block {
  person_id: string;
  day: number;
  slot: number;
  /** 'HH:MM', or null for a whole day off. */
  start_time: string | null;
  end_time: string | null;
  kind_id: string | null;
}

export interface KindRule {
  id: string;
  counts_hours: boolean;
}

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Working hours of one block: nothing for a day off or a block without times. */
export function blockHours(block: Block, kinds: Map<string, KindRule>): number {
  if (!block.start_time || !block.end_time) return 0;
  if (block.kind_id && kinds.get(block.kind_id)?.counts_hours === false) return 0;
  return Math.max(0, minutes(block.end_time) - minutes(block.start_time)) / 60;
}

/** A person's working hours on one day, both blocks together. */
export function dayHours(blocks: Block[], personId: string, day: number, kinds: Map<string, KindRule>): number {
  return blocks.filter((b) => b.person_id === personId && b.day === day).reduce((s, b) => s + blockHours(b, kinds), 0);
}

/** The week's hours as planned — pauses included, as "Total Stunden" always was. */
export function weekHours(blocks: Block[], personId: string, kinds: Map<string, KindRule>): number {
  return blocks.filter((b) => b.person_id === personId).reduce((s, b) => s + blockHours(b, kinds), 0);
}

/**
 * The pause the law asks for, by the day's working time (ArG Art. 15):
 * up to 5½ hours none, over 5½ up to 7 hours 15 minutes, over 7 up to 9
 * hours 30 minutes, over 9 hours an hour.
 */
export function pauseMinutes(hours: number): 0 | 15 | 30 | 60 {
  if (hours > 9) return 60;
  if (hours > 7) return 30;
  if (hours > 5.5) return 15;
  return 0;
}

/**
 * The week's hours actually worked: each day's hours less that day's pause.
 * A contract counts these — 100% is 42 hours worked — so a person's minimum
 * and maximum are compared with this, not with the planned total.
 */
export function workedHours(blocks: Block[], personId: string, kinds: Map<string, KindRule>): number {
  let total = 0;
  for (let day = 0; day < 7; day++) {
    const hours = dayHours(blocks, personId, day, kinds);
    total += hours - pauseMinutes(hours) / 60;
  }
  return total;
}

/** A full contract, in hours worked a week (pauses taken off). */
export const FULL_TIME_HOURS = 42;

/** What a person's share of a full contract comes to: 70% is 29.4 hours worked. */
export function contractHours(percent: number | null): number | null {
  return percent == null ? null : Math.round(FULL_TIME_HOURS * percent) / 100;
}

/**
 * A time as it is typed into the sheet: "0630", "630", "6:30", "6.30" and
 * "6" all mean a time of day. Returns 'HH:MM', '' for nothing typed, or null
 * for something that is not a time.
 */
export function parseTime(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return '';
  const m = text.match(/^(\d{1,2})(?:[:.,h ]?(\d{2}))?$/) ?? text.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2] ?? 0);
  if (hours > 23 || mins > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** A slot's two times as typed into the sheet: '' for none. */
export type Typed = { start: string; end: string };
export const slotKey = (personId: string, day: number, slot: number) => `${personId}:${day}:${slot}`;
/** Both times there, and in order: a block. */
export const isWholeSlot = (v: Typed) => !!v.start && !!v.end && v.end > v.start;

/**
 * The week as it stands on the screen: what is saved, with what has been
 * typed since laid over it — so the totals, the pauses and the warnings answer
 * at once, not after the save comes back. A slot with only one of its two
 * times, or with them out of order, is not a block yet and changes nothing.
 * A slot emptied loses its block — except a day off, which stays as the mark
 * for the whole day.
 */
export function withTyped(blocks: Block[], typed: Record<string, Typed>, kinds: Map<string, KindRule>): Block[] {
  let out = blocks;
  for (const [key, v] of Object.entries(typed)) {
    const [personId, day, slot] = key.split(':');
    const at = (b: Block) => b.person_id === personId && b.day === Number(day) && b.slot === Number(slot);
    const before = blocks.find(at);
    if (isWholeSlot(v)) {
      out = [...out.filter((b) => !at(b)), { person_id: personId, day: Number(day), slot: Number(slot), start_time: v.start, end_time: v.end, kind_id: before?.kind_id ?? null }];
    } else if (!v.start && !v.end) {
      const dayOff = !!before?.kind_id && kinds.get(before.kind_id)?.counts_hours === false;
      out = dayOff ? out.map((b) => (at(b) ? { ...b, start_time: null, end_time: null } : b)) : out.filter((b) => !at(b));
    }
  }
  return out;
}

/** "44.00", "5.50" — as the sheet printed it. */
export function formatHours(hours: number): string {
  return (Math.round(hours * 100) / 100).toFixed(2);
}

/* ------------------------- people in production ------------------------- */

/** A full day in production, in hours: the measure a person is counted against. */
export const FULL_DAY_HOURS = 8.5;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * How many people are in production on each day, and how many the day's
 * product takes.
 *
 * A person counts by their production hours against a full day: all day is
 * one person, two hours before going to the office about a quarter. Only
 * production counts — office, deliveries, cleaning and maintenance are other
 * work. With several products on a day, the one that takes most people sets
 * the need; a product without a figure sets none.
 */
export function productionStaffing(
  blocks: Block[],
  dayProducts: Record<string, string[]>,
  products: { id: string; people_needed: number | null }[],
): { day: number; count: number; need: number | null; short: boolean }[] {
  const needOf = new Map(products.map((p) => [p.id, p.people_needed]));
  return [0, 1, 2, 3, 4, 5, 6].map((day) => {
    const hours = new Map<string, number>();
    for (const b of blocks) {
      if (b.day !== day || b.kind_id || !b.start_time || !b.end_time) continue;
      hours.set(b.person_id, (hours.get(b.person_id) ?? 0) + Math.max(0, minutes(b.end_time) - minutes(b.start_time)) / 60);
    }
    const count = round1([...hours.values()].reduce((s, h) => s + Math.min(1, h / FULL_DAY_HOURS), 0));
    const needs = (dayProducts[String(day)] ?? []).map((id) => needOf.get(id)).filter((n): n is number => n != null);
    const need = needs.length > 0 ? Math.max(...needs) : null;
    return { day, count, need, short: need != null && count < need };
  });
}

/* ------------------------------- warnings ------------------------------- */

export interface PersonRule {
  id: string;
  min_hours: number | null;
  max_hours: number | null;
  is_lead: boolean;
}

export type ScheduleWarning =
  | { kind: 'under'; person_id: string; hours: number; bound: number }
  | { kind: 'over'; person_id: string; hours: number; bound: number }
  | { kind: 'no_lead'; day: number }
  | { kind: 'day_off'; person_id: string; day: number }
  | { kind: 'absence'; person_id: string; day: number };

/**
 * What to look at again. Never a block:
 * - a person's week under their minimum or over their maximum, in hours worked;
 * - a day with production and no production lead at work (a Sunday of
 *   cooking and maintenance needs none);
 * - hours on a day the person is marked off, or has an approved absence.
 */
export function scheduleWarnings(
  blocks: Block[],
  people: PersonRule[],
  kinds: Map<string, KindRule>,
  /** Days (0–6) with an approved absence, per person. */
  absentDays: Map<string, Set<number>> = new Map(),
): ScheduleWarning[] {
  const out: ScheduleWarning[] = [];
  const known = new Set(people.map((p) => p.id));
  const mine = blocks.filter((b) => known.has(b.person_id));

  for (const p of people) {
    const hours = workedHours(mine, p.id, kinds);
    // An empty row is a week not planned yet, not a week too short.
    if (hours > 0 && p.min_hours != null && hours < p.min_hours) out.push({ kind: 'under', person_id: p.id, hours, bound: p.min_hours });
    if (p.max_hours != null && hours > p.max_hours) out.push({ kind: 'over', person_id: p.id, hours, bound: p.max_hours });
  }

  const leads = new Set(people.filter((p) => p.is_lead).map((p) => p.id));
  for (let day = 0; day < 7; day++) {
    const working = people.filter((p) => dayHours(mine, p.id, day, kinds) > 0);
    const production = mine.some((b) => b.day === day && !b.kind_id && !!b.start_time);
    // Without anyone marked as a lead there is nothing to check against.
    if (leads.size > 0 && production && !working.some((p) => leads.has(p.id))) out.push({ kind: 'no_lead', day });
    for (const p of working) {
      const off = mine.some((b) => b.person_id === p.id && b.day === day && !!b.kind_id && kinds.get(b.kind_id)?.counts_hours === false);
      if (off) out.push({ kind: 'day_off', person_id: p.id, day });
      else if (absentDays.get(p.id)?.has(day)) out.push({ kind: 'absence', person_id: p.id, day });
    }
  }
  return out;
}

/* ------------------------------- versions ------------------------------- */

const cellKey = (personId: string, day: number) => `${personId}:${day}`;

function cellText(blocks: Block[]): string {
  return [...blocks]
    .sort((a, b) => a.slot - b.slot)
    .map((b) => `${b.slot}|${b.start_time?.slice(0, 5) ?? ''}|${b.end_time?.slice(0, 5) ?? ''}|${b.kind_id ?? ''}`)
    .join(';');
}

/**
 * The cells — a person's day — that differ between two states of a week:
 * what is drawn yellow as "Cambio en horario". A cell emptied counts too.
 */
export function changedCells(before: Block[], after: Block[]): Set<string> {
  const group = (blocks: Block[]) => {
    const m = new Map<string, Block[]>();
    for (const b of blocks) m.set(cellKey(b.person_id, b.day), [...(m.get(cellKey(b.person_id, b.day)) ?? []), b]);
    return m;
  };
  const a = group(before);
  const b = group(after);
  const changed = new Set<string>();
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (cellText(a.get(key) ?? []) !== cellText(b.get(key) ?? [])) changed.add(key);
  }
  return changed;
}

export const isChanged = (changed: Set<string>, personId: string, day: number) => changed.has(cellKey(personId, day));

/* --------------------------- Sundays and holidays --------------------------- */

export interface RotationMember {
  id: string;
  sunday_order: number;
}

/**
 * Whose turn it is: of those in the rotation, whoever came longest ago —
 * never, first — and among equals, the order of the rotation. A swap needs no
 * special case: the one who came instead simply came more recently.
 */
export function nextSundayTurn(members: RotationMember[], duties: { person_id: string | null; duty_date: string }[]): string | null {
  if (members.length === 0) return null;
  const last = new Map<string, string>();
  for (const d of duties) {
    if (d.person_id && (last.get(d.person_id) ?? '') < d.duty_date) last.set(d.person_id, d.duty_date);
  }
  return [...members].sort((a, b) => (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? '') || a.sunday_order - b.sunday_order)[0].id;
}

/* --------------------------- the weekly cleaning --------------------------- */

export interface CleaningWeek {
  week_start: string;
  cleaning_bathroom: string | null;
  cleaning_kitchen: string | null;
}

/**
 * Whose turn the weekly cleaning is. Baños and Cocina each go round on their
 * own: for each, whoever did it longest ago — never, first — and among equals
 * the order of the rows. Nobody gets both in one week; with a single person
 * to choose from, the kitchen stays open.
 */
export function cleaningTurns(
  members: { id: string; sort_order: number }[],
  /** The weeks before this one. */
  history: CleaningWeek[],
  /** Not there that week: on holiday or ill for all of it. */
  away: ReadonlySet<string> = new Set(),
): { cleaning_bathroom: string | null; cleaning_kitchen: string | null } {
  const next = (task: 'cleaning_bathroom' | 'cleaning_kitchen', taken: string | null) => {
    const last = new Map<string, string>();
    for (const w of history) {
      const id = w[task];
      if (id && (last.get(id) ?? '') < w.week_start) last.set(id, w.week_start);
    }
    const free = members.filter((m) => !away.has(m.id) && m.id !== taken);
    return [...free].sort((a, b) => (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? '') || a.sort_order - b.sort_order)[0]?.id ?? null;
  };
  const cleaning_bathroom = next('cleaning_bathroom', null);
  return { cleaning_bathroom, cleaning_kitchen: next('cleaning_kitchen', cleaning_bathroom) };
}

/** The Sunday a date's week starts on. Dates are 'YYYY-MM-DD'. */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/** The seven dates of a week, Sunday first. */
export function weekDates(weekStart: string): string[] {
  return [...Array(7)].map((_, i) => {
    const d = new Date(`${weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}
