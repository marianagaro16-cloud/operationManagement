import { describe, it, expect } from 'vitest';
import { distanceKm, formatAddress, googleMapsLegs, planRoute, type RouteStop } from './route';

/** Roughly Zurich, and points a few kilometres out in known directions. */
const FACTORY = { latitude: 47.3769, longitude: 8.5417 };
const stop = (orderId: string, latitude: number | null, longitude: number | null, deliveryTime: string | null = null): RouteStop =>
  ({ orderId, latitude, longitude, deliveryTime });

const order = (stops: RouteStop[]) => stops.map((s) => s.orderId);

describe('distance', () => {
  it('measures a known separation', () => {
    // Zurich to Bern is about 95 km in a straight line.
    const bern = { latitude: 46.948, longitude: 7.4474 };
    expect(Math.round(distanceKm(FACTORY, bern))).toBeGreaterThan(90);
    expect(Math.round(distanceKm(FACTORY, bern))).toBeLessThan(100);
  });

  it('is zero for the same point, and symmetric', () => {
    expect(distanceKm(FACTORY, FACTORY)).toBe(0);
    const other = { latitude: 47.4, longitude: 8.6 };
    expect(distanceKm(FACTORY, other)).toBeCloseTo(distanceKm(other, FACTORY), 9);
  });
});

describe('planning the round', () => {
  it('walks to the nearest stop each time, from the factory', () => {
    const near = stop('near', 47.3800, 8.5450);
    const middle = stop('middle', 47.4200, 8.6000);
    const far = stop('far', 47.5000, 8.7000);
    expect(order(planRoute([far, middle, near], FACTORY))).toEqual(['near', 'middle', 'far']);
  });

  it('keeps a promised hour first, even when it is the long way round', () => {
    const near = stop('near', 47.3800, 8.5450);
    const farButPromised = stop('promised', 47.5000, 8.7000, '09:00');
    expect(order(planRoute([near, farButPromised], FACTORY))).toEqual(['promised', 'near']);
  });

  it('puts several promised hours in clock order', () => {
    const ten = stop('ten', 47.50, 8.70, '10:00');
    const eight = stop('eight', 47.60, 8.80, '08:30');
    const nine = stop('nine', 47.40, 8.60, '09:15');
    expect(order(planRoute([ten, eight, nine], FACTORY))).toEqual(['eight', 'nine', 'ten']);
  });

  it('continues the walk from the last promised stop, not from the factory', () => {
    // The promised stop is far east; of the two free stops the eastern one is
    // nearer to it, though the western one is nearer to the factory.
    const promised = stop('promised', 47.3800, 9.0000, '09:00');
    const east = stop('east', 47.3800, 8.9000);
    const west = stop('west', 47.3800, 8.5500);
    expect(order(planRoute([west, east, promised], FACTORY))).toEqual(['promised', 'east', 'west']);
  });

  it('leaves a stop with no coordinates at the end, in the order given', () => {
    const a = stop('a', null, null);
    const b = stop('b', 47.3800, 8.5450);
    const c = stop('c', null, null);
    expect(order(planRoute([a, b, c], FACTORY))).toEqual(['b', 'a', 'c']);
  });

  it('loses nobody, whatever it is given', () => {
    const stops = [stop('a', null, null), stop('b', 47.38, 8.54, '10:00'), stop('c', 47.5, 8.7)];
    expect(order(planRoute(stops, null)).sort()).toEqual(['a', 'b', 'c']);
    expect(planRoute([], FACTORY)).toEqual([]);
  });

  it('still walks without an origin, starting from the first stop given', () => {
    const near = stop('near', 47.3800, 8.5450);
    const far = stop('far', 47.5000, 8.7000);
    expect(order(planRoute([far, near], null))).toEqual(['far', 'near']);
  });
});

describe('the Google Maps links', () => {
  const paramsOf = (url: string) => new URL(url).searchParams;

  it('drives the stops in order and comes home', () => {
    const [leg, ...rest] = googleMapsLegs({ origin: 'Fabrik 1, 8000 Zürich', stops: ['A 1, 8004', 'B 2, 8005'], returnToOrigin: true });
    expect(rest).toHaveLength(0);
    expect(paramsOf(leg).get('origin')).toBe('Fabrik 1, 8000 Zürich');
    expect(paramsOf(leg).get('destination')).toBe('Fabrik 1, 8000 Zürich');
    expect(paramsOf(leg).get('waypoints')).toBe('A 1, 8004|B 2, 8005');
    expect(paramsOf(leg).get('travelmode')).toBe('driving');
  });

  it('ends at the last stop when there is no return leg', () => {
    const [leg] = googleMapsLegs({ origin: 'F', stops: ['A', 'B'], returnToOrigin: false });
    expect(paramsOf(leg).get('destination')).toBe('B');
    expect(paramsOf(leg).get('waypoints')).toBe('A');
  });

  it('is nothing at all with no stops', () => {
    expect(googleMapsLegs({ origin: 'F', stops: [], returnToOrigin: true })).toEqual([]);
  });

  it('splits a long round into legs of nine waypoints, each starting where the last ended', () => {
    const stops = Array.from({ length: 15 }, (_, i) => `S${i + 1}`);
    const legs = googleMapsLegs({ origin: 'F', stops, returnToOrigin: true });
    expect(legs).toHaveLength(2);

    const first = paramsOf(legs[0]);
    expect(first.get('origin')).toBe('F');
    expect(first.get('waypoints')?.split('|')).toHaveLength(9);
    expect(first.get('destination')).toBe('S10');

    const second = paramsOf(legs[1]);
    expect(second.get('origin')).toBe('S10');
    expect(second.get('destination')).toBe('F');
    // Nothing is lost between the legs: S11..S15 are the second leg's waypoints.
    expect(second.get('waypoints')).toBe('S11|S12|S13|S14|S15');
  });

  it('never loses a stop, whatever the length', () => {
    for (const count of [1, 9, 10, 11, 20, 31]) {
      const stops = Array.from({ length: count }, (_, i) => `S${i + 1}`);
      const seen = googleMapsLegs({ origin: 'F', stops, returnToOrigin: true })
        .flatMap((leg) => [
          paramsOf(leg).get('origin') ?? '',
          ...(paramsOf(leg).get('waypoints')?.split('|') ?? []),
          paramsOf(leg).get('destination') ?? '',
        ]);
      for (const stop of stops) expect(seen).toContain(stop);
    }
  });
});

describe('the address line', () => {
  it('joins what there is', () => {
    expect(formatAddress({ street: 'Bahnhofstrasse 1', postal_code: '8001', city: 'Zürich' }))
      .toBe('Bahnhofstrasse 1, 8001 Zürich');
  });

  it('leaves out what is missing, and names a country only when it is not ours', () => {
    expect(formatAddress({ street: null, postal_code: '8001', city: 'Zürich' })).toBe('8001 Zürich');
    expect(formatAddress({ street: 'A 1', city: 'Lindau', country: 'DE' })).toBe('A 1, Lindau, DE');
    expect(formatAddress({})).toBe('');
  });
});
