import type { Product } from '@/types/orders';

/*
 * Deliberately NOT a 'use client' module.
 *
 * This lived in incident-dialog.tsx, which is one. Next.js turns every export
 * of a client module into a client reference on the server, so the order page
 * — a server component — calling orderContextFrom() got a reference instead
 * of the function and threw 'f is not a function': every order detail page
 * returned a 500. Plain data shaping belongs in a module both sides can call.
 */

/**
 * Build the context from a loaded order.
 *
 * One function because three places raise an incident from an order — the
 * order page header, the Order Control list, and anything that follows — and
 * three hand-built objects would drift on the day one of them forgets to
 * carry the lot allocations, which is the part nobody would notice missing
 * until an incident could not be traced to its lot.
 */
export function orderContextFrom(order: {
  id: string;
  reference: number;
  customer_id: string;
  customer: { name: string };
  order_date: string;
  preparation_date: string;
  delivery_date: string;
  delivery_method: { name: string } | null;
  lines: {
    id: string;
    product_id: string;
    product: Product;
    allocations: { id: string; lot_number: string }[];
  }[];
}): OrderContext {
  return {
    id: order.id,
    reference: order.reference,
    customer_id: order.customer_id,
    customer_name: order.customer.name,
    order_date: order.order_date,
    preparation_date: order.preparation_date,
    delivery_date: order.delivery_date,
    delivery_method_name: order.delivery_method?.name ?? null,
    lines: order.lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      product: l.product,
      allocations: (l.allocations ?? []).map((a) => ({ id: a.id, lot_number: a.lot_number })),
    })),
  };
}

/** What an order contributes when the incident is raised from one. */
export interface OrderContext {
  id: string;
  reference: number;
  customer_id: string;
  customer_name: string;
  order_date: string;
  preparation_date: string;
  delivery_date: string;
  delivery_method_name: string | null;
  lines: {
    id: string;
    product_id: string;
    product: Product;
    /** Lot allocations recorded during preparation, for tracing the lot. */
    allocations: { id: string; lot_number: string }[];
  }[];
}
