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

/** "44.00", "5.50" — as the sheet printed it. */
export function formatHours(hours: number): string {
  return (Math.round(hours * 100) / 100).toFixed(2);
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
 * - a person's week under their minimum or over their maximum;
 * - a day people work on with no production lead among them;
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
    const hours = weekHours(mine, p.id, kinds);
    // An empty row is a week not planned yet, not a week too short.
    if (hours > 0 && p.min_hours != null && hours < p.min_hours) out.push({ kind: 'under', person_id: p.id, hours, bound: p.min_hours });
    if (p.max_hours != null && hours > p.max_hours) out.push({ kind: 'over', person_id: p.id, hours, bound: p.max_hours });
  }

  const leads = new Set(people.filter((p) => p.is_lead).map((p) => p.id));
  for (let day = 0; day < 7; day++) {
    const working = people.filter((p) => dayHours(mine, p.id, day, kinds) > 0);
    // Without anyone marked as a lead there is nothing to check against.
    if (leads.size > 0 && working.length > 0 && !working.some((p) => leads.has(p.id))) out.push({ kind: 'no_lead', day });
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
