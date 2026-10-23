'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Fuel, LogIn, LogOut, Pencil, Truck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { formatMinutes, tripKm, tripMinutes } from '@/domain/vehicle/summary';
import type { VehicleAccess, VehicleTrip } from '@/server/vehicle';
import { TripDialog } from './trip-dialog';
import { CostDialog } from './cost-dialog';
import { clock } from './vehicle-bits';

/**
 * Today's round with the Palomo: "Salgo", then "Regresé a la fábrica", each
 * with the km. Not to keep an eye on anyone — so that later, other routes can
 * be planned from what a round really takes.
 */
export function RoundCard({
  vehicleName,
  open,
  today: todays,
  lastKm,
  access,
  viewerId,
  todayDate,
  showLink = true,
}: {
  vehicleName: string;
  /** The round out now, as far as the viewer may see it. */
  open: VehicleTrip | null;
  /** Today's rounds already back. */
  today: VehicleTrip[];
  lastKm: number | null;
  access: VehicleAccess;
  viewerId: string;
  todayDate: string;
  /** On the route: a link to the whole log. */
  showLink?: boolean;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<{ mode: 'start' | 'end' | 'edit'; trip?: VehicleTrip } | null>(null);
  const [costing, setCosting] = useState(false);
  const back = todays.filter((trip) => trip.returned_at);
  const mayStart = access.driver || access.office;

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Truck className="h-4 w-4 text-accent" aria-hidden />
        <span className="mr-auto text-[14px] font-semibold">{t('palomo.roundTitle', { name: vehicleName })}</span>
        {showLink && (
          <Link href="/palomo" className="text-[12.5px] font-medium text-accent hover:underline">
            {t('palomo.seeLog')}
          </Link>
        )}
      </div>

      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="warn">{t('palomo.outSince', { time: clock(open.left_at) })}</Badge>
          <span className="text-[12.5px] text-muted">
            {t('palomo.kmValue', { km: open.left_km })}
            {open.driver && open.driver_id !== viewerId ? ` · ${displayName(open.driver)}` : ''}
          </span>
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => setDialog({ mode: 'end', trip: open })}>
            <LogIn className="h-3.5 w-3.5" aria-hidden />
            {t('palomo.end')}
          </Button>
        </div>
      ) : (
        mayStart && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-muted">{t('palomo.atFactory')}</span>
            <Button size="sm" variant="primary" className="ml-auto" onClick={() => setDialog({ mode: 'start' })}>
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              {t('palomo.start')}
            </Button>
          </div>
        )
      )}

      {back.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-border pt-2">
          {back.map((trip) => (
            <li key={trip.id} className="flex items-center gap-2 text-[12.5px]">
              <span className="tabular">{clock(trip.left_at)} – {clock(trip.returned_at!)}</span>
              <span className="text-muted">
                · {formatMinutes(tripMinutes(trip)!)} · {t('palomo.kmValue', { km: tripKm(trip)! })}
              </span>
              {(access.office || trip.driver_id === viewerId) && (
                <Button size="icon" variant="ghost" className="ml-auto" aria-label={t('common.edit')} onClick={() => setDialog({ mode: 'edit', trip })}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {mayStart && (
        <div className="mt-2">
          <Button size="sm" variant="secondary" onClick={() => setCosting(true)}>
            <Fuel className="h-3.5 w-3.5" aria-hidden />
            {t('palomo.addCost')}
          </Button>
        </div>
      )}

      {dialog && (
        <TripDialog
          mode={dialog.mode}
          trip={dialog.trip}
          lastKm={lastKm}
          canDelete={access.office}
          onClose={() => setDialog(null)}
        />
      )}
      {costing && <CostDialog viewerId={viewerId} office={access.office} today={todayDate} onClose={() => setCosting(false)} />}
    </Card>
  );
}
