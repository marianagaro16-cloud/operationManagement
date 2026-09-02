import type { BusinessDate } from '@/lib/datetime';

/**
 * Go-live date for the orders module.
 *
 * Orders are managed in this application from this date onward; anything
 * earlier stays in the Excel workbooks and is deliberately NOT migrated.
 * Order Control will not navigate to months before it, so an empty month
 * cannot be mistaken for lost data.
 *
 * Change it with NEXT_PUBLIC_ORDERS_GO_LIVE=YYYY-MM-DD (set in .env and in
 * Vercel). It is public because the client-side month navigation needs it.
 */
export const ORDERS_GO_LIVE: BusinessDate =
  process.env.NEXT_PUBLIC_ORDERS_GO_LIVE?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? (process.env.NEXT_PUBLIC_ORDERS_GO_LIVE as BusinessDate)
    : '2026-09-01';

/** `YYYY-MM` of the first month the application is the system of record. */
export const ORDERS_GO_LIVE_MONTH = ORDERS_GO_LIVE.slice(0, 7);

export function isBeforeGoLive(month: string): boolean {
  return month < ORDERS_GO_LIVE_MONTH;
}
