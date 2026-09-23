'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { planRoute } from '@/domain/orders/route';
import { geocodeAddress } from './geocode';
import { getRouteOrigin, getRouteStops, originPoint, ROUTE_ORIGIN_KEY } from './route';
import { getViewer } from './data';
import type { ActionResult } from './actions';

/**
 * Arranging the delivery round.
 *
 * The stops are written one by one through order_set_route_position(), which
 * is what lets whoever DRIVES rearrange the round: a plain user may not
 * update an order, and the position is the single column they may set. Roles
 * that only read orders are still refused, by the same guard as everywhere.
 */

const BUSINESS_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('orders_read_only')) return { ok: false, error: 'orders_read_only' };
  if (message.includes('not_authorized') || message.includes('row-level security')) {
    return { ok: false, error: 'not_authorized' };
  }
  return { ok: false, error: message };
}

/** Write the given order of stops, 1..n. */
async function writePositions(orderIds: string[]): Promise<ActionResult> {
  const supabase = createClient();
  for (const [index, orderId] of orderIds.entries()) {
    const { error } = await supabase.rpc('order_set_route_position', {
      p_order_id: orderId,
      p_position: index + 1,
    });
    if (error) return fail(error);
  }
  revalidatePath('/orders');
  return { ok: true, data: undefined };
}

/**
 * Propose the round for a day: promised hours first, then nearest-first from
 * the factory. Whatever comes out is written as the current order, and the
 * driver rearranges from there.
 */
export async function planDeliveryRoute(date: string): Promise<ActionResult<{ stops: number }>> {
  const parsed = BUSINESS_DATE.safeParse(date);
  if (!parsed.success) return { ok: false, error: 'invalid_date' };

  const [stops, origin] = await Promise.all([getRouteStops(parsed.data), getRouteOrigin()]);
  if (stops.length === 0) return { ok: false, error: 'no_stops' };

  // One stop per address; the orders behind it keep consecutive positions,
  // so the door is visited once whatever it is carrying.
  const planned = planRoute(
    stops.map((s) => ({
      orderId: s.customerId,
      latitude: s.latitude,
      longitude: s.longitude,
      deliveryTime: s.deliveryTime,
    })),
    originPoint(origin),
  );

  const orderIds = planned.flatMap((p) => {
    const stop = stops.find((s) => s.customerId === p.orderId);
    return stop ? stop.orders.map((o) => o.id) : [];
  });

  const written = await writePositions(orderIds);
  if (!written.ok) return written;
  return { ok: true, data: { stops: planned.length } };
}

/** Save the order somebody dragged into place. */
export async function setRouteOrder(orderIds: string[]): Promise<ActionResult> {
  const parsed = z.array(z.string().uuid()).min(1).max(200).safeParse(orderIds);
  if (!parsed.success) return { ok: false, error: 'invalid_route' };
  return writePositions(parsed.data);
}

/* ------------------------------- the origin ------------------------------ */

const originSchema = z.object({
  label: z.string().trim().max(120).nullable().optional(),
  street: z.string().trim().max(200).nullable().optional(),
  postal_code: z.string().trim().max(20).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().length(2).default('CH'),
});

export type RouteOriginInput = z.infer<typeof originSchema>;

/**
 * Where the van starts and ends. Admin-only, like every other system setting,
 * and geocoded on save so the proposed order has somewhere to start from.
 */
export async function saveRouteOrigin(input: RouteOriginInput): Promise<ActionResult<{ located: boolean }>> {
  const parsed = originSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_address' };

  const viewer = await getViewer();
  if (!viewer?.can('system.configure')) return { ok: false, error: 'not_authorized' };

  const address = {
    street: parsed.data.street ?? null,
    postal_code: parsed.data.postal_code ?? null,
    city: parsed.data.city ?? null,
    country: parsed.data.country,
  };
  const coordinates = await geocodeAddress(address);

  const supabase = createClient();
  const { error } = await supabase.from('app_settings').upsert({
    key: ROUTE_ORIGIN_KEY,
    value: {
      label: parsed.data.label ?? null,
      ...address,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    },
    updated_by: viewer.profile.id,
  });
  if (error) return fail(error);

  revalidatePath('/admin/settings');
  revalidatePath('/orders');
  // The address is saved either way; the screen says whether it was found,
  // because an origin that could not be placed changes what the plan can do.
  return { ok: true, data: { located: coordinates !== null } };
}
