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

export interface RouteStopRow {
  orderId: string;
  reference: number;
  customerId: string;
  customerName: string;
  /** "HH:MM" when an hour was promised. */
  deliveryTime: string | null;
  address: string;
  deliveryNotes: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Its place in the round, or null while the round is unplanned. */
  position: number | null;
  /** Lines, so the driver sees what they are carrying without opening the order. */
  items: { product: string; quantity: number }[];
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
  return rows
    .map((row) => ({
      orderId: row.id,
      reference: row.reference,
      customerId: row.customer.id,
      customerName: row.customer.name,
      deliveryTime: row.delivery_time ? row.delivery_time.slice(0, 5) : null,
      address: formatAddress(row.customer),
      deliveryNotes: row.customer.delivery_notes,
      latitude: row.customer.latitude === null ? null : Number(row.customer.latitude),
      longitude: row.customer.longitude === null ? null : Number(row.customer.longitude),
      position: row.route_position,
      items: (row.lines ?? []).map((line) => ({
        product: line.product?.name?.trim() || line.product?.family || '—',
        quantity: Number(line.ordered_quantity),
      })),
      ready: row.ready_at !== null,
      shipped: row.shipped_at !== null,
    }))
    .sort((a, b) => {
      if (a.position !== null && b.position !== null) return a.position - b.position;
      if (a.position !== null) return -1;
      if (b.position !== null) return 1;
      return a.reference - b.reference;
    });
}
