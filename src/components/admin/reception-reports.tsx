'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/app-shell';
import { Badge, Card, EmptyState, ErrorState, Field, Input } from '@/components/ui/primitives';
import { generateReceptionReport } from '@/server/goods-reception-actions';
import type { ReceptionReportPayload } from '@/domain/goods-reception/report';
import type { ReceptionReportSnapshot } from '@/types/goods-reception';
import { useReceptionError } from '@/components/goods-reception/reception-bits';
import { ReceptionReportView } from './reception-report-view';

/**
 * Monthly reception reports.
 *
 * The live month sits above the frozen ones, and the difference between them
 * is stated rather than implied: the top block recomputes on every load and
 * WILL change as the month goes on; a generated report never does.
 *
 * §42 is enforced by the absence of policies rather than by this screen —
 * `goods_reception_report_snapshots` has no update and no delete policy, so a
 * historical report cannot be rewritten by anything, including a bug here.
 */
export function ReceptionReports({
  liveMonth,
  livePayload,
  snapshots,
  canGenerate,
}: {
  liveMonth: string;
  livePayload: ReceptionReportPayload;
  snapshots: ReceptionReportSnapshot[];
  canGenerate: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = useReceptionError();
  const [month, setMonth] = useState(liveMonth);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const res = await generateReceptionReport({
        month,
        note: note.trim() || null,
        // Passed in so the domain and the server layer both stay free of
        // i18n; the frozen payload then carries the label it was generated
        // with, which is what a historical document should do.
        unrecorded_label: t('gr.notRecorded'),
      });
      if (!res.ok) setError(translateError(res.error));
      else {
        setError(null);
        setNote('');
        router.refresh();
      }
    });
  }

  return (
    <>
      <PageHeader title={t('gr.reportsTitle')} subtitle={t('gr.reportsSubtitle')} />

      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      {canGenerate && (
        <Card className="mb-4 p-3.5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('gr.generateFor', { month })} htmlFor="gr-report-month">
              <Input
                id="gr-report-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </Field>
            <Field label={t('gr.reportNote')} htmlFor="gr-report-note">
              <Input id="gr-report-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button variant="primary" loading={pending} onClick={generate}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('gr.generate')}
            </Button>
          </div>
        </Card>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-[15px] font-semibold">{t('gr.liveReport')}</h2>
        <ReceptionReportView payload={livePayload} />
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold">{t('gr.reportsTitle')}</h2>

        {snapshots.length === 0 ? (
          <EmptyState
            title={t('gr.noReports')}
            icon={<FileText className="h-5 w-5" aria-hidden />}
          />
        ) : (
          <ul className="space-y-1.5">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <Link href={`/admin/goods-reception-reports/${snapshot.id}`} className="block">
                  <Card className="p-3 transition-colors hover:border-accent/40 hover:bg-surface-2/40">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold">
                          {snapshot.period_month.slice(0, 7)}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] text-muted">
                          {snapshot.generator
                            ? t('gr.generatedBy', { name: displayName(snapshot.generator) })
                            : ''}
                        </p>
                        {snapshot.note && (
                          <p className="mt-0.5 truncate text-[12px] text-subtle">{snapshot.note}</p>
                        )}
                      </div>
                      <Badge tone="neutral" className="shrink-0">
                        {t('gr.version', { n: snapshot.version })}
                      </Badge>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
