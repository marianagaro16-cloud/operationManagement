import 'server-only';
import { formatAddress } from '@/domain/orders/route';

/**
 * Turning a typed address into coordinates.
 *
 * OpenStreetMap's Nominatim: free, no key, no account, and no bill to
 * forget about. It asks for a real User-Agent and at most one request a
 * second, which an address saved by hand comfortably respects — a customer's
 * address is geocoded when somebody edits it, not on any page load.
 *
 * A failure is not an error the user has to deal with: the address is saved
 * regardless and the stop is simply ordered by hand. That is why this returns
 * null rather than throwing.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'OperationManager/1.0 (delivery round planning)';

export interface Coordinates {
  latitude: number;
  longitude: number;
  /**
   * 'address' when the street itself was found, 'city' when only the town
   * was. A town is still a usable stop position and still worth a human
   * look, which is why the difference is kept rather than rounded away.
   */
  precision: 'address' | 'city';
}

/** Nominatim's own word for what it matched. Everything vaguer than a road is a town. */
const STREET_LEVEL = new Set(['building', 'house', 'house_number', 'road', 'street', 'amenity', 'shop', 'place_house']);

export async function geocodeAddress(address: {
  street?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
}): Promise<Coordinates | null> {
  const query = formatAddress(address);
  if (!query.trim()) return null;

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', (address.country || 'CH').toLowerCase());

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de,es,en' },
      // The address is saved either way; five seconds is long enough to wait
      // for a nicety.
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const results = (await response.json()) as { lat?: string; lon?: string; addresstype?: string }[];
    const first = results?.[0];
    if (!first?.lat || !first?.lon) return null;

    const latitude = Number(first.lat);
    const longitude = Number(first.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      latitude,
      longitude,
      precision: STREET_LEVEL.has(first.addresstype ?? '') ? 'address' : 'city',
    };
  } catch {
    return null;
  }
}
