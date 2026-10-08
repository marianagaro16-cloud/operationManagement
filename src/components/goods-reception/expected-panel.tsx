'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import { AlertTriangle, Link2Off, Pencil } from 'lucide-react';
import { useI18n } from '@/i18n';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Card, CardBody, CardHeader, SectionHeading } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { arrivalVerdict, differenceText, hasDifference } from '@/domain/goods-reception/expected';
import { linkExpectedDelivery, recordExpectedReceived, unlinkExpectedDelivery } from '@/server/expected-delivery-actions';
import type { ExpectedDelivery, ReceptionDetail } from '@/types/goods-reception';
import { ExpectedLines, LoadBadges, initialReceived, toReceived, useExpectedError, useExpectedLabels } from './expected-bits';

/**
 * A reception and the delivery the office announced.
 *
 * Closed one: what was announced beside what was counted, and — when they
 * differ — the incident, already written. Closed none while its supplier has
 * some open: "is it this one?". Otherwise nothing: most deliveries were never
 * announced, and a card saying so on every reception would be noise.
 */
export function ExpectedPanel({
  reception,
  expected,
  candidates,
  canEdit,
  canManage,
  onReport,
  reportNow,
}: {
  reception: ReceptionDetail;
  expected: ExpectedDelivery | null;
  candidates: ExpectedDelivery[];
  /** May write to this reception: count, and answer the question. */
  canEdit: boolean;
  /** The office: may undo the link. */
  canManage: boolean;
  /** Opens the incident dialog with this text; absent when the viewer may not report one. */
  onReport?: (description: string) => void;
  /** Came straight from registering the arrival with a difference. */
  reportNow: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useExpectedLabels();
  const translateError = useExpectedError();
  const [comparing, setComparing] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const differs = expected ? hasDifference(expected.lines) : false;
  const difference = expected
    ? `${t('grx.differenceIntro')}\n${differenceText(expected.lines, (line, wanted, got) =>
        t('grx.differenceLine', { name: labels.lineName(line), expected: wanted, received: got, unit: labels.unit(line.unit) }),
      )}`
    : '';

  // Once, on arriving from the form — not again on every refresh of the page.
  const offered = useRef(false);
  useEffect(() => {
    if (reportNow && differs && onReport && !offered.current) {
      offered.current = true;
      onReport(difference);
    }
  }, [reportNow, differs, onReport, difference]);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(translateError(res.error ?? 'not_authorized'));
      setError(null);
      after?.();
      router.refresh();
    });

  if (!expected) {
    if (candidates.length === 0) return null;
    return (
      <Card className="border-accent/30">
        <CardHeader className="pb-0">
          <SectionHeading title={t('grx.suggestTitle')} subtitle={t('grx.suggestBody')} />
        </CardHeader>
        <CardBody>
          <ul className="space-y-1.5">
            {candidates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[13px]">
                  <span className="font-medium">{labels.when(d)}</span>
                  <LoadBadges delivery={d} />
                </span>
                <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => linkExpectedDelivery(d.id, reception.id))}>
                  {t('grx.isThisOne')}
                </Button>
              </li>
            ))}
          </ul>
          {error && <p className="mt-2 text-[12px] text-late">{error}</p>}
        </CardBody>
      </Card>
    );
  }

  const arrivedOn = DateTime.fromISO(reception.received_at, { zone: 'utc' }).setZone(BUSINESS_TZ).toISODate()!;
  const { verdict, days } = arrivalVerdict(expected, arrivedOn);

  return (
    <Card>
      <CardHeader className="pb-0">
        <SectionHeading
          title={t('grx.panelTitle')}
          action={
            <div className="flex gap-1.5">
              {canEdit && expected.lines.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => setComparing(true)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  {t('grx.editCompare')}
                </Button>
              )}
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => setUnlinking(true)}>
                  <Link2Off className="h-3.5 w-3.5" aria-hidden />
                  {t('grx.unlink')}
                </Button>
              )}
            </div>
          }
        />
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span>{t('grx.expectedFor', { when: labels.when(expected) })}</span>
          <span className={verdict === 'late' ? 'font-medium text-late' : 'text-muted'}>
            ·{' '}
            {verdict === 'on_time'
              ? t('grx.verdict.onTime')
              : t(verdict === 'late' ? 'grx.verdict.late' : 'grx.verdict.early', { days })}
          </span>
          <LoadBadges delivery={expected} />
        </div>
        <p className="mt-0.5 text-[12px] text-muted">{t('grx.arrivedOn', { date: formatDate(arrivedOn, 'short') })}</p>

        {expected.note && <NoteText className="mt-2 text-[13px]" text={expected.note} />}

        {expected.lines.length > 0 && <div className="mt-3"><ExpectedLines lines={expected.lines} /></div>}

        {differs && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-late/30 bg-late/5 px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-late" aria-hidden />
            <p className="min-w-0 flex-1 text-[13px] font-medium text-late">{t('grx.differenceFound')}</p>
            {onReport && (
              <Button size="sm" variant="secondary" onClick={() => onReport(difference)}>
                {t('grx.reportDifference')}
              </Button>
            )}
          </div>
        )}

        {error && <p className="mt-2 text-[12px] text-late">{error}</p>}
      </CardBody>

      {comparing && (
        <CompareDialog
          expected={expected}
          receptionId={reception.id}
          onClose={() => setComparing(false)}
        />
      )}

      <ConfirmDialog
        open={unlinking}
        onClose={() => setUnlinking(false)}
        onConfirm={() => run(() => unlinkExpectedDelivery(expected.id), () => setUnlinking(false))}
        title={t('grx.unlink')}
        message={t('grx.unlinkBody')}
        confirmLabel={t('grx.unlink')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
    </Card>
  );
}

/** Counting again, on a reception already registered. */
function CompareDialog({ expected, receptionId, onClose }: { expected: ExpectedDelivery; receptionId: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = useExpectedError();
  const [received, setReceived] = useState(() => initialReceived(expected.lines));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('grx.compareTitle')}
      description={t('grx.compareHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await recordExpectedReceived(expected.id, receptionId, toReceived(expected.lines, received));
                if (!res.ok) return setError(translateError(res.error));
                onClose();
                router.refresh();
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <ExpectedLines
        lines={expected.lines}
        received={received}
        onReceived={(id, value) => setReceived((all) => ({ ...all, [id]: value }))}
      />
      {error && <p className="mt-2 text-[12px] text-late">{error}</p>}
    </Dialog>
  );
}
