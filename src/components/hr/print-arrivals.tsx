'use client';

import { useEffect } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { teamLabelKey } from '@/lib/authz';
import { localizedName } from '@/lib/localized-content';
import type { HrLateArrival, HrWorkerFile } from '@/types/hr';

export type ArrivalsPeriod = 'month' | '3months' | 'year' | 'all';

const PERIOD_LABEL: Record<ArrivalsPeriod, MessageKey> = {
  month: 'hrLate.thisMonth',
  '3months': 'hrLate.last3Months',
  year: 'hrLate.thisYear',
  all: 'hrPrint.allTime',
};

/**
 * Only the arrivals of one worker — late and too early — over a period, to
 * print and have signed. The whole file has its own page (/print/hr/[id]).
 */
export function PrintArrivals({
  worker,
  arrivals,
  period,
  from,
  today,
}: {
  worker: HrWorkerFile['worker'];
  arrivals: HrLateArrival[];
  period: ArrivalsPeriod;
  /** First day covered; null when there is nothing at all. */
  from: string | null;
  today: string;
}) {
  const { t, formatDate, locale } = useI18n();
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);

  const rows = [...arrivals].sort((a, b) => a.arrival_date.localeCompare(b.arrival_date));
  const late = rows.filter((a) => a.kind === 'late');
  const early = rows.filter((a) => a.kind === 'early');
  const lateMinutes = late.reduce((s, a) => s + a.minutes_off, 0);
  const minutes = (m: number) =>
    m >= 60 ? t('hrLate.hoursMinutes', { h: Math.floor(m / 60), m: m % 60 }) : t('hrLate.minutes', { m });
  const split = (list: HrLateArrival[]) => {
    const unexcused = list.filter((a) => !a.excused).length;
    return [
      list.length - unexcused > 0 ? t('hrLate.excusedCount', { count: list.length - unexcused }) : null,
      unexcused > 0 ? t('hrLate.unexcusedCount', { count: unexcused }) : null,
    ].filter(Boolean).join(' · ');
  };

  return (
    <main className="mx-auto max-w-3xl bg-white p-6 text-[12.5px] text-black print:max-w-none print:p-0">
      <h1 className="text-2xl font-semibold">{t('hrPrint.arrivalsTitle')} — {worker.name}</h1>
      <p className="text-[12.5px]">
        {[t(teamLabelKey(worker.team)), worker.position].filter(Boolean).join(' · ')}
      </p>
      <p className="mb-4 text-[12px] text-neutral-500">
        {t('hrPrint.period')}: {t(PERIOD_LABEL[period])}
        {from && ` (${formatDate(from, 'medium')} – ${formatDate(today, 'medium')})`}
        {' · '}{t('hrPrint.printedOnShort', { date: formatDate(today, 'medium') })}
      </p>

      <div className="mb-4 border border-neutral-300 p-2">
        <p>
          <strong>{t('hrLate.lateCount', { count: late.length })}</strong>
          {late.length > 0 && <span className="text-neutral-600"> ({split(late)} · {minutes(lateMinutes)})</span>}
        </p>
        <p>
          <strong>{t('hrLate.earlyCount', { count: early.length })}</strong>
          {early.length > 0 && <span className="text-neutral-600"> ({split(early)})</span>}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-neutral-500">{t('hrPrint.none')}</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-500">
              <th className="py-1 pr-2 font-medium">{t('hrPrint.day')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrPrint.kind')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrLate.expected')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrLate.arrived')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrPrint.minutes')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrLate.reason')}</th>
              <th className="py-1 pr-2 font-medium">{t('hrPrint.notifiedCol')}</th>
              <th className="py-1 font-medium">{t('hrLate.excused')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="break-inside-avoid border-b border-neutral-200 align-top">
                <td className="py-1 pr-2">{formatDate(a.arrival_date, 'weekday')}</td>
                <td className="py-1 pr-2">{a.kind === 'early' ? t('hrLate.kindEarly') : t('hrLate.kindLate')}</td>
                <td className="py-1 pr-2">{a.expected_time.slice(0, 5)}</td>
                <td className="py-1 pr-2">{a.arrived_time.slice(0, 5)}</td>
                <td className="py-1 pr-2">{a.kind === 'early' ? '−' : '+'}{a.minutes_off}</td>
                <td className="py-1 pr-2">{a.reason ? localizedName(a.reason, locale) : '—'}{a.note && ` — ${a.note}`}</td>
                <td className="py-1 pr-2">{a.notified ? t('hrPrint.yes') : t('hrPrint.no')}</td>
                <td className="py-1">{a.excused ? t('hrPrint.yes') : t('hrPrint.no')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-12 break-inside-avoid">
        <p className="mb-10 text-neutral-600">{t('hrPrint.acknowledge')}</p>
        <div className="grid grid-cols-2 gap-10">
          {[t('hrPrint.signWorker'), t('hrPrint.signHr')].map((label) => (
            <div key={label}>
              <div className="h-10 border-b border-neutral-500" />
              <p className="mt-1 text-[11.5px] text-neutral-600">{label}</p>
              <div className="mt-6 h-6 border-b border-neutral-500" />
              <p className="mt-1 text-[11.5px] text-neutral-600">{t('hrPrint.signDate')}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
