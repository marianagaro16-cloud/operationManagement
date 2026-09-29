/**
 * The times of planned sales activities: "HH:MM" or "HH:MM:SS" strings, as
 * the database's time columns come back.
 */

const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const pad = (n: number) => String(n).padStart(2, '0');

/** A time plus some minutes, kept within the day (never past 23:59). */
export function addMinutes(time: string, minutes: number): string {
  const total = Math.min(minutesOf(time) + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** "10:00–10:30", "10:00" without an end, or null without a start. */
export function timeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  return end ? `${start.slice(0, 5)}–${end.slice(0, 5)}` : start.slice(0, 5);
}

export interface Timed {
  id: string;
  start: string | null;
  end: string | null;
}

/**
 * Which activities overlap which: only those with both a start and an end
 * can — a call "at 10" with no end is a moment, not a span. Touching ends
 * (10:00–10:30 and 10:30–11:00) do not overlap.
 */
export function overlapping<T extends Timed>(items: T[]): Map<string, T[]> {
  const spans = items.filter((i) => i.start && i.end);
  const found = new Map<string, T[]>();
  for (const a of spans) {
    for (const b of spans) {
      if (a.id === b.id) continue;
      if (minutesOf(a.start!) < minutesOf(b.end!) && minutesOf(b.start!) < minutesOf(a.end!)) {
        found.set(a.id, [...(found.get(a.id) ?? []), b]);
      }
    }
  }
  return found;
}
