'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Clock, MapPin, Navigation, Route, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { NoteChip } from '@/components/ui/note';
import { googleMapsUrl } from '@/domain/orders/route';
import { planDeliveryRoute, setRouteOrder } from '@/server/route-actions';
import type { RouteOrigin, RouteStopRow } from '@/server/route';

/**
 * The day's round with our own van.
 *
 * The app proposes an order — promised hours first, then nearest-first from
 * the factory — and whoever drives rearranges it, because they know about the
 * roadworks. Moving a stop saves immediately: a round that says one thing on
 * the screen and another in the database is worse than no round at all.
 *
 * The driving itself happens in Google Maps, which the button opens with the
 * stops in exactly this order.
 */
export function RouteView({
  stops: initial,
  origin,
  date,
  canReorder,
}: {
  stops: RouteStopRow[];
  origin: RouteOrigin | null;
  date: string;
  /** Read-only roles see the round and do not rearrange it. */
  canReorder: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [stops, setStops] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The server is the truth; a refresh after saving brings the new order back.
  useEffect(() => setStops(initial), [initial]);

  const originLine = origin
    ? [origin.street, [origin.postal_code, origin.city].filter(Boolean).join(' ')]
      .filter((part) => part && part.trim())
      .join(', ')
    : '';

  const mapsHref = googleMapsUrl({
    origin: originLine || null,
    // A stop with no address still has a customer; Maps searches the name.
    stops: stops.map((s) => s.address || s.customerName),
    returnToOrigin: Boolean(originLine),
  });

  const withoutAddress = stops.filter((s) => !s.address).length;
  const unplaceable = stops.filter((s) => s.address && s.latitude === null).length;

  function save(next: RouteStopRow[]) {
    setStops(next);
    setError(null);
    startTransition(async () => {
      const res = await setRouteOrder(next.map((s) => s.orderId));
      if (!res.ok) {
        setError(res.error === 'orders_read_only' ? t('orders.ordersReadOnly') : res.error);
        setStops(initial);
        return;
      }
      router.refresh();
    });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    [next[index], next[target]] = [next[target], next[index]];
    save(next);
  }

  function plan() {
    setError(null);
    startTransition(async () => {
      const res = await planDeliveryRoute(date);
      if (!res.ok) {
        setError(
          res.error === 'no_stops' ? t('route.noStops')
            : res.error === 'orders_read_only' ? t('orders.ordersReadOnly')
              : res.error,
        );
        return;
      }
      router.refresh();
    });
  }

  if (stops.length === 0) {
    return <EmptyState title={t('route.noStops')} body={t('route.noStopsBody')} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13px] text-muted">
          {t('route.stopCount', { count: stops.length })} · {formatDate(date, 'weekday')}
        </p>
        {canReorder && (
          <Button size="sm" variant="secondary" onClick={plan} loading={pending}>
            <Route className="h-3.5 w-3.5" aria-hidden />
            {t('route.plan')}
          </Button>
        )}
        {mapsHref && (
          <a href={mapsHref} target="_blank" rel="noreferrer">
            <Button size="sm" variant="primary">
              <Navigation className="h-3.5 w-3.5" aria-hidden />
              {t('route.openMaps')}
            </Button>
          </a>
        )}
      </div>

      {/* What the plan could not take into account, said plainly. */}
      {!origin?.latitude && (
        <p className="text-[12.5px] text-warn">{t('route.noOrigin')}</p>
      )}
      {withoutAddress > 0 && (
        <p className="text-[12.5px] text-warn">{t('route.missingAddresses', { count: withoutAddress })}</p>
      )}
      {unplaceable > 0 && (
        <p className="text-[12.5px] text-warn">{t('route.notPlaced', { count: unplaceable })}</p>
      )}

      {error && <ErrorState message={error} />}

      <ol className="space-y-2">
        {stops.map((stop, index) => (
          <li key={stop.orderId}>
            <Card className={cn('p-3', stop.shipped && 'opacity-70')}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[12px] font-semibold tabular text-accent">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/orders/${stop.orderId}`}
                      className="text-[13.5px] font-medium hover:text-accent hover:underline"
                    >
                      {stop.customerName}
                    </Link>
                    <span className="text-[11.5px] tabular text-subtle">#{stop.reference}</span>
                    {stop.deliveryTime && (
                      <Badge tone="warn">
                        <Clock className="h-2.5 w-2.5" aria-hidden />
                        {stop.deliveryTime}
                      </Badge>
                    )}
                    {stop.shipped
                      ? <Badge tone="done">{t('orders.tabShipped')}</Badge>
                      : stop.ready ? <Badge tone="accent">{t('orders.tabReady')}</Badge> : null}
                  </div>

                  <p className="mt-0.5 flex items-start gap-1 text-[12.5px] text-muted">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    {stop.address || (
                      <span className="inline-flex items-center gap-1 text-warn">
                        <TriangleAlert className="h-3 w-3" aria-hidden />
                        {t('route.noAddress')}
                      </span>
                    )}
                  </p>

                  {stop.deliveryNotes && <NoteChip className="mt-1.5">{stop.deliveryNotes}</NoteChip>}

                  {/* What is on board for this stop. */}
                  {stop.items.length > 0 && (
                    <p className="mt-1.5 text-[12px] text-subtle">
                      {stop.items.map((i) => `${i.quantity}× ${i.product}`).join(' · ')}
                    </p>
                  )}
                </div>

                {canReorder && (
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('route.moveUp')}
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('route.moveDown')}
                      disabled={pending || index === stops.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
