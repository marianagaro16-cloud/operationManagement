import { describe, expect, it } from 'vitest';
import { nearbyPlaces, orderVisits, visitRouteLinks, type VisitPlace } from './visits';

// Around Zürich: the start, then places at increasing distance.
const at = (id: string, latitude: number | null, longitude: number | null, street: string | null = null): VisitPlace => ({
  id, street, postal_code: null, city: street ? 'Zürich' : null, latitude, longitude,
});
const start = at('start', 47.3769, 8.5417, 'Bahnhofstrasse 1');
const near = at('near', 47.38, 8.545, 'Near 1');
const mid = at('mid', 47.40, 8.55, 'Mid 1');
const far = at('far', 47.45, 8.60, 'Far 1');

describe('orderVisits', () => {
  it('goes nearest-first from the start address', () => {
    const order = orderVisits(
      [
        { id: 'v-far', plannedTime: null, place: far },
        { id: 'v-near', plannedTime: null, place: near },
        { id: 'v-mid', plannedTime: null, place: mid },
      ],
      start,
    );
    expect(order).toEqual(['v-near', 'v-mid', 'v-far']);
  });

  it('puts a visit at a set time first, earliest first', () => {
    const order = orderVisits(
      [
        { id: 'v-near', plannedTime: null, place: near },
        { id: 'v-far-11', plannedTime: '11:00:00', place: far },
        { id: 'v-mid-10', plannedTime: '10:00:00', place: mid },
      ],
      start,
    );
    expect(order.slice(0, 2)).toEqual(['v-mid-10', 'v-far-11']);
  });

  it('keeps a place with no map position, last', () => {
    const order = orderVisits(
      [
        { id: 'v-unplaced', plannedTime: null, place: at('u', null, null) },
        { id: 'v-near', plannedTime: null, place: near },
      ],
      start,
    );
    expect(order).toEqual(['v-near', 'v-unplaced']);
  });
});

describe('visitRouteLinks', () => {
  it('starts and ends at the start address, stops in the order given', () => {
    const [link] = visitRouteLinks([near, far], start);
    const url = new URL(link);
    expect(url.searchParams.get('origin')).toBe('Bahnhofstrasse 1, Zürich');
    expect(url.searchParams.get('destination')).toBe('Bahnhofstrasse 1, Zürich');
    expect(url.searchParams.get('waypoints')).toBe('Near 1, Zürich|Far 1, Zürich');
  });

  it('can end somewhere else than it starts', () => {
    const office = at('office', 47.39, 8.49, 'Aargauerstrasse 250');
    const [link] = visitRouteLinks([near], start, office);
    const url = new URL(link);
    expect(url.searchParams.get('origin')).toBe('Bahnhofstrasse 1, Zürich');
    expect(url.searchParams.get('waypoints')).toBe('Near 1, Zürich');
    expect(url.searchParams.get('destination')).toBe('Aargauerstrasse 250, Zürich');
  });

  it('falls back to coordinates when a place has no address', () => {
    const [link] = visitRouteLinks([at('x', 47.1, 8.2)], start);
    expect(new URL(link).searchParams.get('waypoints')).toBe('47.1,8.2');
  });
});

describe('nearbyPlaces', () => {
  it('finds what is close to the plan, closest first, not already planned', () => {
    const found = nearbyPlaces([near, mid, far, start], [start], 5);
    expect(found.map((f) => f.place.id)).toEqual(['near', 'mid']);
  });

  it('has nothing to offer before a placed visit is planned', () => {
    expect(nearbyPlaces([near], [at('u', null, null)])).toEqual([]);
  });
});
