/**
 * Who is using the app right now — the rules, without I/O.
 *
 * An open app checks in every HEARTBEAT_MS while it is visible (see
 * `PresenceBeacon`). Somebody is online while their last check-in is younger
 * than ONLINE_WINDOW_MS: that is three heartbeats, so one slow or dropped
 * request never flickers a person offline, and closing the app shows up within
 * about a minute and a half.
 */

/** One person's last check-in, as stored in `user_presence`. */
export interface PresenceRow {
  user_id: string;
  last_seen_at: string;
  /** When this stretch of use began. */
  started_at: string;
  path: string | null;
}

export const HEARTBEAT_MS = 30_000;
export const ONLINE_WINDOW_MS = 90_000;

export function isOnline(lastSeenAt: string | null | undefined, now: number): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) && now - seen < ONLINE_WINDOW_MS;
}

/**
 * The top-level area a route belongs to, e.g. `/orders/abc-123` → `orders`.
 *
 * The screen names a SECTION rather than the path, because a path carries
 * record ids nobody can read, and the section is what an admin wants to know.
 */
export type PresenceArea =
  | 'dashboard'
  | 'orders'
  | 'lot-tracker'
  | 'incidents'
  | 'goods-reception'
  | 'inventory'
  | 'reminders'
  | 'calendar'
  | 'admin'
  | 'settings';

const AREAS: readonly PresenceArea[] = [
  'dashboard',
  'orders',
  'lot-tracker',
  'incidents',
  'goods-reception',
  'inventory',
  'reminders',
  'calendar',
  'admin',
  'settings',
];

export function areaFor(path: string | null | undefined): PresenceArea | null {
  const first = path?.split(/[/?#]/).filter(Boolean)[0];
  // Preparation became the Orders screen; an old bookmark still lands there.
  if (first === 'preparation') return 'orders';
  return AREAS.find((a) => a === first) ?? null;
}
