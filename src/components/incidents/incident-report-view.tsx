'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { BUSINESS_TZ } from '@/lib/datetime';
import { vocabularyKey } from '@/domain/incidents/vocabulary';
import { DEFAULT_THRESHOLDS } from '@/domain/incidents/patterns';
import { compareBuckets, type Bucket, type IncidentReportPayload } from '@/domain/incidents/report';
import type { Pattern } from '@/domain/incidents/patterns';
import { generateReportSnapshot } from '@/server/incident-actions';
import type { IncidentReportSnapshot } from '@/types/incidents';
import { categoryKey, typeKey } from './incident-list';

/**
 * The monthly incident report.
 *
 * Two things share this component: the LIVE month, recomputed on every visit,
 * and a SAVED snapshot, frozen when somebody pressed the button. They are
 * rendered identically because they are the same document — the snapshot is
 * literally the payload the live view produced — and each says at the top
 * which one it is, because a reader acting on numbers needs to know whether
 * they can still move.
 *
 * The report is organised around §25's questions in §25's order: what
 * happened, why, whose, who and what was involved, what repeats, and what we
 * are doing. The sections that count RECORDED FINDINGS carry a different note
 * from the ones that count ASSOCIATION, and neither borrows the other's
 * wording.
 */
export function IncidentReportView({
  payload,
  month,
  snapshot,
  previous,
  snapshots,
  canGenerate,
}: {
  payload: IncidentReportPayload;
  month: string;
  /** Set when viewing a saved report rather than the live month. */
  snapshot?: IncidentReportSnapshot;
  /** The most recent saved report for an earlier month, for the comparison. */
  previous?: IncidentReportSnapshot;
  /** The history list, shown alongside the live report. */
  snapshots?: IncidentReportSnapshot[];
  canGenerate: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const anchor = DateTime.fromISO(`${month}-01`, { zone: BUSINESS_TZ });
  const shift = (delta: number) => anchor.plus({ months: delta }).toFormat('yyyy-MM');
  const isLive = !snapshot;

  const s = payload.summary;
  const a = payload.correctiveActions;

  return (
    <>
      <PageHeader
        title={t('ireport.title')}
        subtitle={t('ireport.subtitle')}
        action={
          <a href={`/admin/incident-reports/export?month=${month}${snapshot ? `&snapshot=${snapshot.id}` : ''}`}>
            <Button variant="secondary" size="sm">{t('ireport.exportCsv')}</Button>
          </a>
        }
      />

      {/* Which document this is. Never implicit. */}
      <div
        className={cn(
          'mb-3 rounded-lg border px-3.5 py-2.5',
          isLive ? 'border-accent/25 bg-accent/[0.05]' : 'border-border bg-surface-2/60',
        )}
      >
        <p className="text-[13px] font-medium">
          {isLive ? t('ireport.live') : t('ireport.snapshot')}
          {snapshot && ` · ${t('ireport.version', { version: snapshot.version })}`}
        </p>
        <p className="mt-0.5 text-[12px] text-muted">
          {isLive ? t('ireport.liveHint') : t('ireport.snapshotHint')}
        </p>
        {snapshot && (
          <p className="mt-1 text-[11.5px] text-subtle">
            {t('ireport.generated', {
              date: formatDate(snapshot.generated_at.slice(0, 10)),
              name: snapshot.generator?.name ?? snapshot.generator?.email ?? '—',
            })}
          </p>
        )}
      </div>

      {/* Month navigation, only on the live report — a saved one IS its month. */}
      {isLive && (
        <div className="mb-4 flex items-center gap-1.5">
          <Link href={`/admin/incident-reports?month=${shift(-1)}`}>
            <Button size="icon" variant="secondary" aria-label={t('incident.previousPage')}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
          <span className="min-w-32 text-center text-[13px] font-medium capitalize">
            {formatDate(`${month}-01`, 'monthYear')}
          </span>
          <Link href={`/admin/incident-reports?month=${shift(1)}`}>
            <Button size="icon" variant="secondary" aria-label={t('incident.nextPage')}>
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      )}

      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      <div className="space-y-4">
        {/* ---------- executive summary ---------- */}
        <Section title={t('ireport.execSummary')}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
            <Stat label={t('ireport.total')} value={s.total} />
            <Stat label={t('ireport.ordersAffected')} value={s.ordersAffected} />
            <Stat label={t('ireport.customersAffected')} value={s.customersAffected} />
            <Stat label={t('ireport.productsAffected')} value={s.productsAffected} />
            <Stat label={t('ireport.replacements')} value={s.replacements} />
            <Stat label={t('ireport.open')} value={s.open} />
            <Stat label={t('ireport.resolved')} value={s.resolved} />
            <Stat label={t('ireport.closed')} value={s.closed} />
            <Stat label={t('ireport.high')} value={s.high} tone={s.high > 0 ? 'warn' : undefined} />
            <Stat
              label={t('ireport.critical')}
              value={s.critical}
              tone={s.critical > 0 ? 'late' : undefined}
            />
          </div>
        </Section>

        {/* ---------- where are we failing ---------- */}
        <Section title={t('ireport.whereFailing')}>
          <BucketList buckets={payload.byCategory} translate={(k) => t(categoryKey(k))} month={month} param="categoryId" resolve={false} />
          <div className="mt-3 border-t border-border pt-3">
            <BucketList buckets={payload.byType} translate={(k) => t(typeKey(k))} month={month} param="typeId" resolve={false} />
          </div>
        </Section>

        {/* ---------- why: recorded findings ---------- */}
        <Section title={t('ireport.why')} note={t('ireport.whyHint')}>
          <BucketList
            buckets={payload.byPrimaryCause}
            translate={(k) => t(`incident.cause.${vocabularyKey(k)}` as MessageKey)}
            month={month}
            param="primaryCause"
            resolve
          />
          {payload.bySecondaryCause.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-subtle">
                {t('incident.secondaryCauses')}
              </p>
              <BucketList
                buckets={payload.bySecondaryCause}
                translate={(k) => t(`incident.cause.${vocabularyKey(k)}` as MessageKey)}
                month={month}
              />
            </div>
          )}
        </Section>

        {/* ---------- responsibility: recorded findings ---------- */}
        <Section title={t('ireport.responsibilityTitle')} note={t('ireport.responsibilityHint')}>
          <BucketList
            buckets={payload.byResponsibility}
            translate={(k) => t(`incident.responsibility.${vocabularyKey(k)}` as MessageKey)}
            month={month}
            param="responsibility"
            resolve
          />
        </Section>

        {/* ---------- association: NOT fault ---------- */}
        <Section title={t('ireport.customerAnalysis')} note={t('ireport.involvementHint')}>
          <BucketList buckets={payload.byCustomer} month={month} param="customerId" resolve />
        </Section>

        <Section title={t('ireport.productAnalysis')} note={t('ireport.involvementHint')}>
          <BucketList buckets={payload.byProduct} month={month} param="productId" resolve />
        </Section>

        <Section title={t('ireport.deliveryAnalysis')} note={t('ireport.involvementHint')}>
          <BucketList buckets={payload.byDeliveryMethod} month={month} param="deliveryMethodId" resolve />
        </Section>

        {/* ---------- recurring patterns ---------- */}
        <Section
          title={t('ireport.recurring')}
          note={t('ireport.recurringHint', { min: DEFAULT_THRESHOLDS.minCount })}
        >
          {payload.patterns.length === 0 ? (
            <p className="text-[13px] text-muted">{t('ireport.noPatterns')}</p>
          ) : (
            <ul className="space-y-1.5">
              {payload.patterns.map((p) => (
                <li key={`${p.dimension}:${p.key}`} className="text-[13px]">
                  <PatternSentence pattern={p} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---------- corrective actions ---------- */}
        <Section title={t('ireport.correctiveActions')}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <Stat label={t('ireport.actTotal')} value={a.total} />
            <Stat label={t('ireport.actOpen')} value={a.open} />
            <Stat label={t('ireport.actOverdue')} value={a.overdue} tone={a.overdue > 0 ? 'late' : undefined} />
            <Stat label={t('ireport.actDueThisPeriod')} value={a.dueThisPeriod} />
            <Stat label={t('ireport.actCompleted')} value={a.completed} />
          </div>
        </Section>

        {/* ---------- comparison ---------- */}
        {previous && (
          <Section
            title={t('ireport.compare', {
              month: DateTime.fromISO(previous.period_month, { zone: BUSINESS_TZ }).toFormat('LLLL yyyy'),
            })}
            note={t('ireport.compareHint')}
          >
            <ComparisonTable
              previous={previous.payload.byCategory ?? []}
              current={payload.byCategory}
              translate={(k) => t(categoryKey(k))}
            />
          </Section>
        )}

        {/* ---------- freezing this month ---------- */}
        {isLive && canGenerate && (
          <Section title={t('ireport.generate')} note={t('ireport.generateHint')}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('ireport.notePlaceholder')}
                aria-label={t('ireport.note')}
                className="min-w-0 flex-1"
              />
              <Button
                variant="primary"
                loading={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const res = await generateReportSnapshot(month, note);
                    if (!res.ok) return setError(t('incident.errSaveFailed'));
                    setNote('');
                    router.refresh();
                  })
                }
              >
                <Save className="h-3.5 w-3.5" aria-hidden />
                {t('ireport.generate')}
              </Button>
            </div>
          </Section>
        )}

        {/* ---------- history ---------- */}
        {isLive && (
          <Section title={t('ireport.history')}>
            {!snapshots || snapshots.length === 0 ? (
              <EmptyState title={t('ireport.noSnapshots')} body={t('ireport.noSnapshotsBody')} />
            ) : (
              <ul className="divide-y divide-border">
                {snapshots.map((snap) => (
                  <li key={snap.id}>
                    <Link
                      href={`/admin/incident-reports/${snap.id}`}
                      className="flex items-center gap-3 py-2 transition-colors hover:text-accent"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium capitalize">
                        {formatDate(snap.period_month, 'monthYear')}
                        {snap.version > 1 && (
                          <span className="ml-1.5 text-[11.5px] font-normal text-muted">
                            {t('ireport.version', { version: snap.version })}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 tabular text-[12px] text-muted">
                        {snap.payload?.summary?.total ?? 0}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-subtle">
                        {formatDate(snap.generated_at.slice(0, 10), 'short')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
    </>
  );
}

/* -------------------------------- pieces -------------------------------- */

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {/* The note is what stops a bar chart being read as a blame list. */}
        {note && <p className="mt-1 text-[12px] text-subtle">{note}</p>}
      </CardHeader>
      <CardBody className="pt-2.5">{children}</CardBody>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn' | 'late';
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2">
      <p
        className={cn(
          'tabular text-[19px] font-semibold leading-tight',
          tone === 'warn' && 'text-warn',
          tone === 'late' && 'text-late',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11.5px] text-muted">{label}</p>
    </div>
  );
}

/**
 * A counted breakdown, as bars.
 *
 * Every row links into the incident list with the matching filter, which is
 * §25's requirement that a reader can drill from a number into the records
 * behind it. `resolve` says whether the bucket key is something the list can
 * filter on — a secondary cause is counted here but has no list filter, so it
 * renders as plain text rather than a link that would silently do nothing.
 */
function BucketList({
  buckets,
  translate,
  month,
  param,
  resolve = false,
}: {
  buckets: Bucket[];
  translate?: (key: string) => string;
  month: string;
  param?: string;
  resolve?: boolean;
}) {
  const { t } = useI18n();
  if (buckets.length === 0) {
    return <p className="text-[13px] text-muted">{t('ireport.noData')}</p>;
  }

  const max = Math.max(...buckets.map((b) => b.count));
  const range = monthBounds(month);

  return (
    <ul className="space-y-1">
      {buckets.map((b) => {
        const label = b.label ?? (translate ? translate(b.key) : b.key);
        const href =
          param && resolve
            ? `/incidents?from=${range.from}&to=${range.to}&${param}=${encodeURIComponent(b.key)}`
            : null;

        const row = (
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
            <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full bg-accent/70"
                style={{ width: `${Math.round((b.count / max) * 100)}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right tabular text-[12.5px] font-medium">
              {b.count}
            </span>
          </span>
        );

        return (
          <li key={b.key}>
            {href ? (
              <Link href={href} className="block rounded px-1 py-0.5 hover:bg-surface-2/60">
                {row}
              </Link>
            ) : (
              <span className="block px-1 py-0.5">{row}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One pattern, in the wording its KIND allows.
 *
 * `involvement` gets "was involved in"; `finding` gets "was recorded as the
 * primary cause". The two sentences live in the dictionaries under separate
 * keys and the branch is on data, so no translation edit can turn an
 * association into an accusation.
 */
function PatternSentence({ pattern }: { pattern: Pattern }) {
  const { t } = useI18n();

  const label =
    pattern.label ??
    (pattern.dimension === 'primary_cause'
      ? t(`incident.cause.${vocabularyKey(pattern.key)}` as MessageKey)
      : pattern.dimension === 'responsibility'
        ? t(`incident.responsibility.${vocabularyKey(pattern.key)}` as MessageKey)
        : pattern.dimension === 'category'
          ? t(categoryKey(pattern.key))
          : pattern.dimension === 'incident_type'
            ? t(typeKey(pattern.key))
            : pattern.key);

  if (pattern.kind === 'finding') {
    return (
      <>
        {t('ireport.patternFinding', {
          label,
          count: pattern.count,
          outOf: pattern.outOf,
          dimension: t(
            pattern.dimension === 'responsibility'
              ? 'ireport.dimResponsibility'
              : 'ireport.dimPrimaryCause',
          ),
        })}
      </>
    );
  }

  return (
    <>{t('ireport.patternInvolvement', { label, count: pattern.count, outOf: pattern.outOf })}</>
  );
}

function ComparisonTable({
  previous,
  current,
  translate,
}: {
  previous: Bucket[];
  current: Bucket[];
  translate: (key: string) => string;
}) {
  const { t } = useI18n();
  const deltas = compareBuckets(previous, current);
  if (deltas.length === 0) return <p className="text-[13px] text-muted">{t('ireport.noData')}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[24rem] text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-left text-[11.5px] text-subtle">
            <th className="py-1 font-medium">&nbsp;</th>
            <th className="py-1 text-right font-medium">{t('ireport.comparePrevious')}</th>
            <th className="py-1 text-right font-medium">{t('ireport.compareCurrent')}</th>
            <th className="py-1 text-right font-medium">{t('ireport.compareChange')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deltas.map((d) => (
            <tr key={d.key}>
              <td className="py-1.5">{d.label ?? translate(d.key)}</td>
              <td className="py-1.5 text-right tabular">{d.previous}</td>
              <td className="py-1.5 text-right tabular">{d.current}</td>
              <td
                className={cn(
                  'py-1.5 text-right tabular font-medium',
                  // Fewer incidents is green; more is amber. Neither claims a
                  // reason — §27 keeps this to arithmetic.
                  d.change < 0 && 'text-done',
                  d.change > 0 && 'text-warn',
                )}
              >
                {d.change > 0 ? `+${d.change}` : d.change}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function monthBounds(month: string): { from: string; to: string } {
  const dt = DateTime.fromISO(`${month}-01`, { zone: BUSINESS_TZ });
  return {
    from: dt.startOf('month').toFormat('yyyy-MM-dd'),
    to: dt.endOf('month').toFormat('yyyy-MM-dd'),
  };
}
