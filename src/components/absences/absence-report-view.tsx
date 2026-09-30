'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { Badge, Card, Field, Input } from '@/components/ui/primitives';
import type { AbsenceReport } from '@/server/absence-report';
import type { AbsenceType } from '@/types/absences';
import { useAbsenceLabels } from './absence-parts';
import { useConflictText, usePermissionLabel } from './coverage-planner';

const hoursOf = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Absences and coverage over a period: for approvers. */
export function AbsenceReportView({
  report,
  from,
  to,
  types,
}: {
  report: AbsenceReport;
  from: string;
  to: string;
  types: AbsenceType[];
}) {
  const { t, formatDate } = useI18n();
  const labels = useAbsenceLabels();
  const permLabel = usePermissionLabel();
  const conflictText = useConflictText();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('tab', 'report');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const action = (kind: string, a: string) => t(`absenceReport.act_${kind}_${a}` as MessageKey);

  return (
    <div className="space-y-4">
      <Card className="grid max-w-md grid-cols-2 gap-3 p-3">
        <Field label={t('absence.from')}>
          <Input type="date" value={from} onChange={(e) => set('from', e.target.value)} />
        </Field>
        <Field label={t('absence.until')}>
          <Input type="date" value={to} min={from} onChange={(e) => set('to', e.target.value)} />
        </Field>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title={t('absenceReport.people')} empty={report.people.length === 0}>
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-border">
              {report.people.map((p) => (
                <tr key={p.profile_id}>
                  <td className="py-1.5 pr-2 font-medium">{p.name}</td>
                  <td className="py-1.5 pr-2 text-[12px] text-muted">
                    {Object.entries(p.byType).map(([type, n]) => `${labels.type(types, type)} ${num(n)}`).join(' · ')}
                    {p.pending > 0 && <Badge tone="warn" className="ml-1.5">{t('absenceReport.pending', { count: p.pending })}</Badge>}
                  </td>
                  <td className="py-1.5 text-right tabular">{t('absenceReport.days', { count: num(p.days) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>

        <Block title={t('absenceReport.coverers')} empty={report.coverers.length === 0}>
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-border">
              {report.coverers.map((c) => (
                <tr key={c.profile_id}>
                  <td className="py-1.5 pr-2 font-medium">{c.name}</td>
                  <td className="py-1.5 pr-2 text-[12px] text-muted">{t('absenceReport.periods', { count: c.periods })}</td>
                  <td className="py-1.5 text-right tabular">{hoursOf(c.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>

        <Block title={t('absenceReport.uncovered')} empty={report.uncovered.length === 0} emptyText={t('absenceReport.uncoveredNone')}>
          <ul className="space-y-1.5 text-[13px]">
            {report.uncovered.map((u) => (
              <li key={u.absence_id}>
                <Link href={`/absences/${u.absence_id}`} className="font-medium hover:text-accent">{u.name}</Link>
                <ul className="text-[12.5px] text-late">
                  {u.days.map((d) => (
                    <li key={d.date}>
                      {formatDate(d.date, 'weekday')} · {d.gaps.map((g) => `${g.start}–${g.end}`).join(', ')}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Block>

        <Block title={t('absenceReport.conflicts')} empty={report.conflicts.length === 0} emptyText={t('absenceReport.conflictsNone')}>
          <ul className="space-y-1.5 text-[13px]">
            {report.conflicts.map((c) => (
              <li key={c.assignment_id}>
                <Link href={`/absences/${c.absence_id}`} className="hover:text-accent">
                  {formatDate(c.date, 'weekday')} {c.start}–{c.end}: {t('absenceReport.covers', { coverer: c.coverer, covering: c.covering })}
                </Link>
                <ul className="text-[12.5px] text-warn">
                  {c.conflicts.map((x, i) => <li key={i}>⚠ {conflictText(c.coverer, x)}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </Block>
      </div>

      <Block title={t('absenceReport.grants')} empty={report.grants.length === 0}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-border">
              {report.grants.map((g, i) => (
                <tr key={i} className={g.revoked ? 'text-muted line-through' : undefined}>
                  <td className="py-1.5 pr-2 tabular">{formatDate(g.date, 'short')} {g.start}–{g.end}</td>
                  <td className="py-1.5 pr-2">{t('absenceReport.covers', { coverer: g.coverer, covering: g.covering })}</td>
                  <td className="py-1.5 pr-2"><Badge tone="accent">{permLabel(g.permission)}</Badge></td>
                  <td className="py-1.5 text-[12px] text-muted">{g.by ? t('absenceReport.givenBy', { name: g.by }) : ''}{g.revoked ? ` · ${t('absenceReport.revoked')}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block title={t('absenceReport.history')} empty={report.history.length === 0}>
        <ul className="divide-y divide-border text-[13px]">
          {report.history.map((h, i) => (
            <li key={i} className="flex flex-wrap gap-x-2 py-1.5">
              <span className="w-32 shrink-0 tabular text-muted">{formatDate(h.at.slice(0, 10), 'short')} {new Date(h.at).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })}</span>
              <Link href={`/absences/${h.absence_id}`} className="font-medium hover:text-accent">{h.about}</Link>
              <span>{action(h.kind, h.action)}</span>
              {h.actor && <span className="text-muted">— {h.actor}</span>}
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}

function Block({ title, empty, emptyText, children }: { title: string; empty: boolean; emptyText?: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Card className="p-3">
      <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {empty ? <p className="text-[12.5px] text-muted">{emptyText ?? t('absenceReport.none')}</p> : children}
    </Card>
  );
}
