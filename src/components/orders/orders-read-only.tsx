'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Orders shown to someone who may only look — the production manager.
 *
 * A context rather than a prop, like the box types: the controls it hides
 * (lots, shortfalls, boxes, Ready, Shipped) sit three components down from
 * the screens that know who is viewing. The database rejects the writes
 * regardless (guard_orders_read_only); this only keeps the buttons away.
 */
const OrdersReadOnlyContext = createContext(false);

export function OrdersReadOnlyProvider({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return <OrdersReadOnlyContext.Provider value={readOnly}>{children}</OrdersReadOnlyContext.Provider>;
}

export function useOrdersReadOnly(): boolean {
  return useContext(OrdersReadOnlyContext);
}
