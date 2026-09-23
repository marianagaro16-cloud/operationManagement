/**
 * The order of the stops on a delivery round.
 *
 * Pure and free of I/O, like the reports next door: what the van is asked to
 * drive is decided here and unit-tested, rather than emerging from whatever a
 * map service happened to return.
 *
 * Two rules, in this order:
 *
 *   1. A promised HOUR is a promise. Stops carrying a delivery time go first,
 *      earliest first, whatever the detour costs — arriving at 11:30 with a
 *      shorter route is still late.
 *   2. The rest go nearest-first from wherever the van already is, starting
 *      at the origin. A greedy walk, not the shortest possible tour: with a
 *      dozen stops it is within a few minutes of optimal, it is obvious to
 *      the person reading it, and it never surprises them.
 *
 * The result is a PROPOSAL. Whoever drives rearranges it, because they know
 * about the roadworks and this file does not.
 */

export interface RouteStop {
  /** The order this stop delivers. */
  orderId: string;
  latitude: number | null;
  longitude: number | null;
  /** "HH:MM[:SS]" when the customer was promised an hour, else null. */
  deliveryTime: string | null;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Straight-line distance in kilometres.
 *
 * The van drives roads, not great circles, so this understates every leg —
 * but it understates them all in the same way, and the plan only needs to
 * compare one leg with another.
 */
export function distanceKm(a: RoutePoint, b: RoutePoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const located = (stop: RouteStop): stop is RouteStop & RoutePoint =>
  stop.latitude !== null && stop.longitude !== null;

/**
 * Order the stops of one round.
 *
 * Stops with no coordinates — an address nobody has filled in, or one the
 * geocoder could not place — keep their incoming order and go last. They are
 * not dropped: the round still has to visit them, and saying so is more
 * useful than a plan that quietly forgets a customer.
 */
export function planRoute(stops: RouteStop[], origin: RoutePoint | null): RouteStop[] {
  const timed = stops.filter((s) => s.deliveryTime !== null)
    .sort((a, b) => (a.deliveryTime ?? '').localeCompare(b.deliveryTime ?? ''));

  const untimed = stops.filter((s) => s.deliveryTime === null);
  const placeable = untimed.filter(located);
  const unlocated = untimed.filter((s) => !located(s));

  // The walk starts wherever the timed stops left the van; with none, at the
  // origin. Without either, the first stop is simply the first one given.
  const lastTimed = [...timed].reverse().find(located) ?? null;
  let from: RoutePoint | null = lastTimed ?? origin;

  const remaining = [...placeable];
  const walked: RouteStop[] = [];
  while (remaining.length > 0) {
    let nextIndex = 0;
    if (from) {
      let best = Infinity;
      remaining.forEach((stop, index) => {
        const d = distanceKm(from as RoutePoint, stop as RouteStop & RoutePoint);
        if (d < best) { best = d; nextIndex = index; }
      });
    }
    const [next] = remaining.splice(nextIndex, 1);
    walked.push(next);
    from = next as RouteStop & RoutePoint;
  }

  return [...timed, ...walked, ...unlocated];
}

/**
 * Google Maps takes at most nine waypoints in a link — a round of fifteen
 * doors does not fit in one. Anything longer is cut into legs that each end
 * where the next begins, so the driver opens leg 1, drives it, opens leg 2.
 */
const MAX_WAYPOINTS = 9;

/**
 * The round as Google Maps links: origin, the stops in order, and back.
 *
 * Addresses rather than coordinates, because that is what the driver reads
 * when the app opens; a stop with no address falls back to its coordinates.
 * Maps keeps the order given — `dir_action=navigate` would re-sort it.
 *
 * One link for a short round, several for a long one. Never a single link
 * that quietly loses the tenth stop.
 */
export function googleMapsLegs(params: {
  origin: string | null;
  stops: string[];
  /** Back to the origin at the end of the round. */
  returnToOrigin: boolean;
}): string[] {
  const stops = params.stops.filter((s) => s.trim());
  if (stops.length === 0) return [];

  const origin = params.origin?.trim() || null;
  const sequence = [
    ...(origin ? [origin] : []),
    ...stops,
    ...(params.returnToOrigin && origin ? [origin] : []),
  ];
  if (sequence.length < 2) return [];

  const legs: string[] = [];
  // Each leg is a start, up to nine waypoints and a destination; the
  // destination of one leg is the start of the next.
  for (let start = 0; start < sequence.length - 1; start += MAX_WAYPOINTS + 1) {
    const leg = sequence.slice(start, start + MAX_WAYPOINTS + 2);
    if (leg.length < 2) break;

    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('origin', leg[0]);
    url.searchParams.set('destination', leg[leg.length - 1]);
    const waypoints = leg.slice(1, -1);
    if (waypoints.length > 0) url.searchParams.set('waypoints', waypoints.join('|'));
    url.searchParams.set('travelmode', 'driving');
    legs.push(url.toString());
  }
  return legs;
}

/** One line for a map, a label or a geocoder. Empty parts are left out. */
export function formatAddress(customer: {
  street?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
}): string {
  const line = [customer.street, [customer.postal_code, customer.city].filter(Boolean).join(' ')]
    .filter((part) => part && part.trim())
    .join(', ');
  const country = customer.country?.trim();
  return line && country && country !== 'CH' ? `${line}, ${country}` : line;
}
