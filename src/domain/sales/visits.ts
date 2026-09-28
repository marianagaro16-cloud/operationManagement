import { distanceKm, formatAddress, googleMapsLegs, planRoute, type RoutePoint } from '@/domain/orders/route';

/**
 * A salesperson's day of visits, as a route.
 *
 * The same rules as the delivery round (domain/orders/route): a visit at a set
 * time is a promise and goes first, earliest first; the rest nearest-first
 * from the start address. A proposal — the salesperson rearranges it.
 */

export interface VisitPlace {
  id: string;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PlannedVisit {
  id: string;
  plannedTime: string | null;
  place: VisitPlace;
}

const point = (p: { latitude: number | null; longitude: number | null } | null): RoutePoint | null =>
  p && p.latitude !== null && p.longitude !== null ? { latitude: p.latitude, longitude: p.longitude } : null;

/** The visits' ids in the proposed order. */
export function orderVisits(visits: PlannedVisit[], start: VisitPlace | null): string[] {
  return planRoute(
    visits.map((v) => ({
      orderId: v.id,
      latitude: v.place.latitude,
      longitude: v.place.longitude,
      deliveryTime: v.plannedTime,
    })),
    point(start),
  ).map((s) => s.orderId);
}

/** An address for Maps; coordinates when there is no address to read. */
function stopText(place: VisitPlace): string {
  const address = formatAddress(place);
  if (address) return address;
  return place.latitude !== null && place.longitude !== null ? `${place.latitude},${place.longitude}` : '';
}

/**
 * The day as Google Maps links, in the order given, from the start address
 * and back to it. Several links when there are more stops than one link holds.
 */
export function visitRouteLinks(places: VisitPlace[], start: VisitPlace | null): string[] {
  return googleMapsLegs({
    origin: start ? stopText(start) || null : null,
    stops: places.map(stopText),
    returnToOrigin: true,
  });
}

/**
 * Who else is close to the day's visits: places within `maxKm` of any of
 * them, not already on the plan, the closest first.
 */
export function nearbyPlaces<T extends VisitPlace>(
  candidates: T[],
  planned: VisitPlace[],
  maxKm = 5,
  limit = 8,
): { place: T; km: number }[] {
  const anchors = planned.map(point).filter((p): p is RoutePoint => p !== null);
  if (anchors.length === 0) return [];
  const taken = new Set(planned.map((p) => p.id));
  return candidates
    .filter((c) => !taken.has(c.id))
    .map((c) => {
      const p = point(c);
      return { place: c, km: p ? Math.min(...anchors.map((a) => distanceKm(a, p))) : Infinity };
    })
    .filter((x) => x.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
