'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Paperclip, Pencil, Plus, Truck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn, displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/app-shell';
import { Card, EmptyState, Input } from '@/components/ui/primitives';
import { formatMinutes, tripKm, tripMinutes, type MonthSummary } from '@/domain/vehicle/summary';
import type { VehicleAccess, VehicleCost, VehicleTrip } from '@/server/vehicle';
import { RoundCard } from './round-card';
import { TripDialog } from './trip-dialog';
import { CostDialog } from './cost-dialog';
import { chf, clock, useCostKindLabel } from './vehicle-bits';

export type PalomoTab = 'rounds' | 'costs' | 'summary';

/**
 * The Palomo's log: its rounds, its costs, and — for the office — what they
 * add up to month by month. A driver sees their own rounds and costs only.
 */
export function PalomoView({
  tab,
  month,
  vehicleName,
  access,
  viewerId,
  today,
  open,
  todays,
  lastKm,
  trips,
  costs,
  summary,
}: {
  tab: PalomoTab;
  /** YYYY-MM shown on Rondas and Gastos. */
  month: string;
  vehicleName: string;
  access: VehicleAccess;
  viewerId: string;
  today: string;
  open: VehicleTrip | null;
  todays: VehicleTrip[];
  lastKm: number | null;
  trips: VehicleTrip[];
  costs: VehicleCost[];
  summary: MonthSummary[] | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const tabs: { key: PalomoTab; label: string }[] = [
    { key: 'rounds', label: t('palomo.tabRounds') },
    { key: 'costs', label: t('palomo.tabCosts') },
    ...(access.office ? [{ key: 'summary' as const, label: t('palomo.tabSummary') }] : []),
  ];

  return (
    <>
      <PageHeader title={vehicleName} subtitle={t('palomo.subtitle')} />

      <div className="mb-4 flex gap-1 rounded-lg bg-surface-2 p-1">
        {tabs.map(({ key, label }) => (
          <Link
            key={key}
            href={`/palomo?tab=${key}&month=${month}`}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === key ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </div>

      {tab !== 'summary' && (
        <div className="mb-3 flex items-center gap-2">
          <Input
            type="month"
            value={month}
            max={today.slice(0, 7)}
            aria-label={t('palomo.month')}
            className="max-w-[11rem]"
            onChange={(e) => e.target.value && router.push(`/palomo?tab=${tab}&month=${e.target.value}`)}
          />
          {!access.office && <span className="text-[12px] text-subtle">{t('palomo.onlyYours')}</span>}
        </div>
      )}

      {tab === 'rounds' && (
        <div className="space-y-3">
          <RoundCard vehicleName={vehicleName} open={open} today={todays} lastKm={lastKm} access={access} viewerId={viewerId} todayDate={today} showLink={false} />
          <RoundList trips={trips} access={access} viewerId={viewerId} today={today} />
        </div>
      )}
      {tab === 'costs' && <CostList costs={costs} access={access} viewerId={viewerId} today={today} />}
      {tab === 'summary' && summary && <SummaryTable rows={summary} />}
    </>
  );
}

function RoundList({ trips, access, viewerId, today }: { trips: VehicleTrip[]; access: VehicleAccess; viewerId: string; today: string }) {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState<VehicleTrip | null>(null);
  const back = trips.filter((trip) => trip.returned_at);
  if (back.length === 0) return <EmptyState title={t('palomo.noRounds')} icon={<Truck className="h-5 w-5" aria-hidden />} />;

  const minutes = back.reduce((sum, trip) => sum + tripMinutes(trip)!, 0);
  const km = back.reduce((sum, trip) => sum + tripKm(trip)!, 0);

  return (
    <>
      <p className="text-[12.5px] text-muted">
        {t('palomo.monthLine', { rounds: back.length, time: formatMinutes(minutes), avg: formatMinutes(Math.round(minutes / back.length)), km })}
      </p>
      <ul className="space-y-1.5">
        {back.map((trip) => (
          <li key={trip.id}>
            <Card className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">
                  {formatDate(trip.trip_date, 'weekday')}
                  <span className="ml-2 tabular text-muted">{clock(trip.left_at)} – {clock(trip.returned_at!)}</span>
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {formatMinutes(tripMinutes(trip)!)} · {t('palomo.kmValue', { km: tripKm(trip)! })}
                  {' '}({trip.left_km} → {trip.returned_km})
                  {access.office && trip.driver ? ` · ${displayName(trip.driver)}` : ''}
                </p>
                {trip.note && <p className="mt-1 text-[12.5px]">{trip.note}</p>}
              </div>
              {(access.office || (trip.driver_id === viewerId && trip.trip_date === today)) && (
                <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(trip)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {editing && <TripDialog mode="edit" trip={editing} canDelete={access.office} onClose={() => setEditing(null)} />}
    </>
  );
}

function CostList({ costs, access, viewerId, today }: { costs: VehicleCost[]; access: VehicleAccess; viewerId: string; today: string }) {
  const { t, formatDate } = useI18n();
  const kindLabel = useCostKindLabel();
  const [editing, setEditing] = useState<VehicleCost | null>(null);
  const [creating, setCreating] = useState(false);
  const total = costs.reduce((sum, c) => sum + Number(c.amount), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="mr-auto text-[12.5px] text-muted">{costs.length > 0 ? t('palomo.costTotal', { total: chf(total) }) : ''}</p>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('palomo.newCost')}
        </Button>
      </div>
      {costs.length === 0 ? (
        <EmptyState title={t('palomo.noCosts')} />
      ) : (
        <ul className="space-y-1.5">
          {costs.map((c) => (
            <li key={c.id}>
              <Card className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">
                    {kindLabel(c.kind)}
                    <span className="ml-2 tabular">{chf(c.amount)}</span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {formatDate(c.spent_on, 'short')}
                    {c.litres != null ? ` · ${Number(c.litres)} l` : ''}
                    {c.odometer_km != null ? ` · ${t('palomo.kmValue', { km: c.odometer_km })}` : ''}
                    {access.office && c.creator ? ` · ${displayName(c.creator)}` : ''}
                  </p>
                  {c.note && <p className="mt-1 text-[12.5px]">{c.note}</p>}
                  {c.receipt_url && (
                    <a href={c.receipt_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
                      <Paperclip className="h-3 w-3" aria-hidden />
                      {t('palomo.receiptOpen')}
                    </a>
                  )}
                </div>
                {(access.office || (c.created_by === viewerId && c.spent_on === today)) && (
                  <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(c)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {(creating || editing) && (
        <CostDialog
          cost={editing ?? undefined}
          viewerId={viewerId}
          office={access.office}
          today={today}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SummaryTable({ rows }: { rows: MonthSummary[] }) {
  const { t, formatDate } = useI18n();
  if (rows.length === 0) return <EmptyState title={t('palomo.noSummary')} />;
  const money = (v: number) => (v > 0 ? v.toFixed(2) : '—');
  const cols: { label: string; value: (r: MonthSummary) => string }[] = [
    { label: t('palomo.sumRounds'), value: (r) => String(r.rounds) },
    { label: t('palomo.sumTime'), value: (r) => (r.minutes ? formatMinutes(r.minutes) : '—') },
    { label: t('palomo.sumAvgTime'), value: (r) => (r.avgMinutes != null ? formatMinutes(r.avgMinutes) : '—') },
    { label: t('palomo.sumKm'), value: (r) => (r.km ? String(r.km) : '—') },
    { label: t('palomo.sumAvgKm'), value: (r) => (r.avgKm != null ? String(r.avgKm) : '—') },
    { label: t('palomo.sumFuel'), value: (r) => money(r.fuel) },
    { label: t('palomo.sumLitres'), value: (r) => (r.litres ? String(r.litres) : '—') },
    { label: t('palomo.sumPer100'), value: (r) => (r.litresPer100 != null ? String(r.litresPer100) : '—') },
    { label: t('palomo.sumRoad'), value: (r) => money(r.road) },
    { label: t('palomo.sumFixed'), value: (r) => money(r.fixed) },
    { label: t('palomo.sumOther'), value: (r) => money(r.other) },
    { label: t('palomo.sumRepairs'), value: (r) => money(r.repairs) },
    { label: t('palomo.sumTotal'), value: (r) => money(r.total) },
    { label: t('palomo.sumPerKm'), value: (r) => (r.perKm != null ? r.perKm.toFixed(2) : '—') },
  ];

  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-muted">{t('palomo.summaryHint')}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-2 text-left text-subtle">
            <tr>
              <th className="px-2.5 py-2 font-medium">{t('palomo.month')}</th>
              {cols.map((c) => <th key={c.label} className="whitespace-nowrap px-2.5 py-2 text-right font-medium">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-t border-border">
                <td className="whitespace-nowrap px-2.5 py-2 font-medium">{formatDate(`${r.month}-01`, 'monthYear')}</td>
                {cols.map((c) => <td key={c.label} className="whitespace-nowrap px-2.5 py-2 text-right tabular">{c.value(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
