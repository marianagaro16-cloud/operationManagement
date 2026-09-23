import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { formatAddress, type RoutePoint } from '@/domain/orders/route';
import type { BusinessDate } from '@/lib/datetime';

/**
 * The delivery round: the day's own-van deliveries, as stops.
 *
 * There is no route table. An order has one delivery date and one delivery
 * method, so the round IS a query over orders — a stored copy could disagree
 * with the orders it claims to describe. The only thing kept is the ORDER of
 * the stops, in orders.route_position.
 */

/** Where the van leaves from and comes back to. */
export const ROUTE_ORIGIN_KEY = 'route.origin';

export interface RouteOrigin {
  label: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * A stop is an ADDRESS, not an order.
 *
 * Three orders for the same restaurant are one door, rung once. Listing them
 * as three stops made a round of fifteen doors read as twenty-one, and the
 * proposed order then spent two of its steps travelling nowhere.
 */
export interface RouteStopRow {
  /** The customer: one address, one stop. */
  customerId: string;
  customerName: string;
  /** Every order dropped at this door, in reference order. */
  orders: { id: string; reference: number; deliveryTime: string | null; ready: boolean; shipped: boolean }[];
  /** The earliest hour promised at this door, if any. */
  deliveryTime: string | null;
  address: string;
  deliveryNotes: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Its place in the round, or null while the round is unplanned. */
  position: number | null;
  /** What comes off the van here, across every order for this door. */
  items: { product: string; quantity: number }[];
  /** Everything for this door is prepared / has left. */
  ready: boolean;
  shipped: boolean;
}

export async function getRouteOrigin(): Promise<RouteOrigin | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', ROUTE_ORIGIN_KEY)
    .maybeSingle();

  const value = (data as { value: Partial<RouteOrigin> } | null)?.value;
  if (!value) return null;
  return {
    label: value.label ?? null,
    street: value.street ?? null,
    postal_code: value.postal_code ?? null,
    city: value.city ?? null,
    country: value.country ?? 'CH',
    latitude: value.latitude ?? null,
    longitude: value.longitude ?? null,
  };
}

/** The origin as a point, or null while nobody has set an address that could be found. */
export function originPoint(origin: RouteOrigin | null): RoutePoint | null {
  if (origin?.latitude === null || origin?.latitude === undefined) return null;
  if (origin.longitude === null || origin.longitude === undefined) return null;
  return { latitude: Number(origin.latitude), longitude: Number(origin.longitude) };
}

const STOP_SELECT = `
  id, reference, delivery_time, route_position, ready_at, shipped_at,
  customer:customers!inner (
    id, name, street, postal_code, city, country, delivery_notes, latitude, longitude
  ),
  delivery_method:delivery_methods!inner ( id, name, own_vehicle ),
  lines:order_lines ( ordered_quantity, product:products ( name, family, presentation ) )
`;

interface RawStop {
  id: string;
  reference: number;
  delivery_time: string | null;
  route_position: number | null;
  ready_at: string | null;
  shipped_at: string | null;
  customer: {
    id: string; name: string; street: string | null; postal_code: string | null;
    city: string | null; country: string | null; delivery_notes: string | null;
    latitude: number | string | null; longitude: number | string | null;
  };
  lines: { ordered_quantity: number | string; product: { name: string | null; family: string; presentation: string } | null }[] | null;
}

/**
 * One day's round, in the order it is driven.
 *
 * Unplanned stops sort after planned ones, by reference, so a newly added
 * order appears at the end rather than jumping into the middle of a round
 * somebody already arranged.
 */
export async function getRouteStops(date: BusinessDate): Promise<RouteStopRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('orders')
    .select(STOP_SELECT)
    .eq('delivery_date', date)
    .eq('delivery_methods.own_vehicle', true)
    .neq('status', 'cancelled')
    .order('reference', { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as RawStop[];

  const byCustomer = new Map<string, RouteStopRow>();
  for (const row of rows) {
    const stop = byCustomer.get(row.customer.id) ?? {
      customerId: row.customer.id,
      customerName: row.customer.name,
      orders: [],
      deliveryTime: null,
      address: formatAddress(row.customer),
      deliveryNotes: row.customer.delivery_notes,
      latitude: row.customer.latitude === null ? null : Number(row.customer.latitude),
      longitude: row.customer.longitude === null ? null : Number(row.customer.longitude),
      position: null,
      items: [],
      ready: true,
      shipped: true,
    };

    const time = row.delivery_time ? row.delivery_time.slice(0, 5) : null;
    stop.orders.push({
      id: row.id,
      reference: row.reference,
      deliveryTime: time,
      ready: row.ready_at !== null,
      shipped: row.shipped_at !== null,
    });

    // The earliest hour promised at this door is the one the round must keep.
    if (time && (stop.deliveryTime === null || time < stop.deliveryTime)) stop.deliveryTime = time;
    // The door is done when every order for it is done.
    stop.ready = stop.ready && row.ready_at !== null;
    stop.shipped = stop.shipped && row.shipped_at !== null;
    // Where the orders disagree, the earliest position wins, so a stop never
    // jumps because a second order was added to it later.
    if (row.route_position !== null) {
      stop.position = stop.position === null ? row.route_position : Math.min(stop.position, row.route_position);
    }

    // The same product on two orders for one door is one thing to unload.
    for (const line of row.lines ?? []) {
      const product = line.product?.name?.trim() || line.product?.family || '—';
      const existing = stop.items.find((i) => i.product === product);
      if (existing) existing.quantity += Number(line.ordered_quantity);
      else stop.items.push({ product, quantity: Number(line.ordered_quantity) });
    }

    byCustomer.set(row.customer.id, stop);
  }

  return [...byCustomer.values()]
    .map((stop) => ({ ...stop, orders: [...stop.orders].sort((a, b) => a.reference - b.reference) }))
    .sort((a, b) => {
      if (a.position !== null && b.position !== null) return a.position - b.position;
      if (a.position !== null) return -1;
      if (b.position !== null) return 1;
      return a.orders[0].reference - b.orders[0].reference;
    });
}
