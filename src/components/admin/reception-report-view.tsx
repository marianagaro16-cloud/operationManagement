'use client';

import Link from 'next/link';
import { Info } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { Card, CardBody, CardHeader, SectionHeading } from '@/components/ui/primitives';
import { StatusChip } from '@/components/ui/status-chip';
import {
  detectReceptionPatterns,
  type PartyPerformance,
  type ReceptionReportPayload,
} from '@/domain/goods-reception/report';
import { useReceptionLabels } from '@/components/goods-reception/reception-bits';

/**
 * A reception report, live or frozen.
 *
 * ONE component for both, deliberately: a snapshot is the same payload shape
 * the live screen computes, and rendering them differently would let a frozen
 * report and its live equivalent disagree about what a number means.
 *
 * THE THING THIS SCREEN MUST NOT DO is imply blame. Every figure is a count
 * of DELIVERIES with a property — "20 receptions, 2 with incidents" — and the
 * note under each party table says so in words. §41: responsibility is a
 * field somebody records during an incident investigation, and it is not
 * here, because this report cannot know it.
 */
export function ReceptionReportView({ payload }: { payload: ReceptionReportPayload }) {
  const { t } = useI18n();
  const labels = useReceptionLabels();
  const patterns = detectReceptionPatterns(payload);

  const s = payload.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-0">
          <SectionHeading title={payload.period} />
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label={t('gr.total')} value={s.total} />
            <Metric label={t('gr.completedCount')} value={s.completed} />
            <Metric label={t('gr.openCount')} value={s.open} />
            <Metric label={t('gr.withIncidentsCount')} value={s.withIncidents} />
            <Metric label={t('gr.incidentsCount')} value={s.incidents} />
            <Metric label={t('gr.discrepancies')} value={s.withDiscrepancy} />
            <Metric label={t('gr.notCheckedCount')} value={s.notChecked} />
            <Metric label={t('gr.conditionProblems')} value={s.withConditionProblem} />
          </dl>
        </CardBody>
      </Card>

      {patterns.length > 0 && (
        <Card>
          <CardHeader className="pb-0">
            <SectionHeading title={t('gr.patterns')} />
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5">
              {patterns.map((pattern) => (
                <li key={`${pattern.kind}-${pattern.key}`} className="text-[13px]">
                  {t(`gr.pattern${capitalise(pattern.kind)}` as MessageKey, {
                    label: pattern.label,
                    count: pattern.count,
                  })}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <PartyTable title={t('gr.bySupplier')} rows={payload.suppliers} />
      <PartyTable title={t('gr.byTransporter')} rows={payload.transporters} />

      <div className="grid gap-4 lg:grid-cols-3">
        <BucketCard
          title={t('gr.byCondition')}
          rows={payload.byCondition.map((b) => ({
            key: b.key,
            label: labels.condition(b.key),
            count: b.count,
          }))}
        />
        <BucketCard
          title={t('gr.byQuantityCheck')}
          rows={payload.byQuantityCheck.map((b) => ({
            key: b.key,
            label: labels.quantity(b.key),
            count: b.count,
          }))}
        />
        <BucketCard title={t('gr.byReceiver')} rows={payload.byReceiver} />
      </div>

      {payload.openReceptions.length > 0 && (
        <Card>
          <CardHeader className="pb-0">
            <SectionHeading title={t('gr.openReceptions')} />
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5">
              {payload.openReceptions.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/goods-reception/${row.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 hover:border-accent/40"
                  >
                    <span className="font-mono text-[12.5px]">{row.reception_number}</span>
                    <StatusChip domain="reception" status={row.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function PartyTable({ title, rows }: { title: string; rows: PartyPerformance[] }) {
  const { t } = useI18n();
  if (rows.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-0">
        <SectionHeading title={title} />
      </CardHeader>

      {/* §41, in words rather than only in field names. Somebody reading a
          table of counts beside a supplier's name will draw a conclusion; the
          note is what stops it being the wrong one. */}
      <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2 sm:mx-5">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
        <p className="text-[12px] text-muted">{t('gr.neutralNote')}</p>
      </div>

      {/* Scrolls inside itself rather than pushing the page sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-2 font-semibold sm:px-5">{title}</th>
              <th className="px-3 py-2 text-right font-semibold">{t('gr.receptions')}</th>
              <th className="px-3 py-2 text-right font-semibold">{t('gr.withIncidentsCount')}</th>
              <th className="px-3 py-2 text-right font-semibold">{t('gr.discrepancies')}</th>
              <th className="px-3 py-2 text-right font-semibold">{t('gr.conditionProblems')}</th>
              <th className="px-4 py-2 text-right font-semibold sm:px-5">{t('gr.incidentRate')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 sm:px-5">{row.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.receptions}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.withIncidents}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.withDiscrepancy}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.withConditionProblem}</td>
                <td className="px-4 py-2 text-right tabular-nums sm:px-5">
                  {row.incidentRate === null ? (
                    // A dash with a tooltip, never "0%". §40: a rate off two
                    // deliveries misleads more than it informs, and printing
                    // one anyway is how a small supplier acquires a reputation.
                    <span className="text-subtle" title={t('gr.rateWithheld')}>
                      —
                    </span>
                  ) : (
                    `${(row.incidentRate * 100).toFixed(0)}%`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BucketCard({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; count: number }[];
}) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-0">
        <SectionHeading title={title} />
      </CardHeader>
      <CardBody>
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate">{row.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">{row.count}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** 'supplier_incidents' -> 'SupplierIncidents', to address the message key. */
function capitalise(kind: string): string {
  return kind
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}
