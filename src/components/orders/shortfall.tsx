'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { setLineShortfall } from '@/server/order-actions';
import { productLabel, SHORTFALL_CODES, type OrderLine, type ShortfallCode } from '@/types/orders';
import { noteToPlainLine } from '@/domain/notes';

/*
 * Why a product is short or not sent, on one order line.
 *
 * A reason from a fixed list (so the reasons can be counted) plus a note, and
 * — once per line — an incident about it, raised by whoever is preparing.
 * The incident is pre-filled from the order: the person at the shelf says
 * what is missing and why, and the investigation stays with the managers.
 */

const CODE_KEY: Record<ShortfallCode, MessageKey> = {
  no_stock: 'prep.shortfallNoStock',
  damaged: 'prep.shortfallDamaged',
  short_shelf_life: 'prep.shortfallShortShelfLife',
  quality_hold: 'prep.shortfallQualityHold',
  other: 'prep.shortfallOther',
};

const ERROR_KEY: Record<string, MessageKey> = {
  reason_required: 'prep.shortfallRequired',
  line_not_short: 'prep.errLineNotShort',
  order_ready_locked: 'orders.errReadyLocked',
  order_not_confirmed: 'orders.errNotConfirmed',
  not_authorized: 'orders.errFulfilmentNotAuthorized',
};

export function useShortfallLabel() {
  const { t } = useI18n();
  return (code: ShortfallCode) => t(CODE_KEY[code]);
}

/** The recorded reason and its incident, read-only. Nothing when there is no reason. */
export function ShortfallSummary({ line, className }: { line: OrderLine; className?: string }) {
  const { t } = useI18n();
  const label = useShortfallLabel();
  const note = line.shortfall_reason?.trim();
  if (!line.shortfall_code && !note) return null;

  return (
    <p className={cn('rounded-md bg-surface-2 px-2 py-1 text-[12px] text-muted', className)}>
      <span className="font-medium">{t('prep.shortfallReason')}:</span>{' '}
      {[line.shortfall_code ? label(line.shortfall_code) : null, noteToPlainLine(note)].filter(Boolean).join(' — ')}
      {line.shortfall_incident && (
        <>
          {' · '}
          <Link
            href={`/incidents/${line.shortfall_incident.id}`}
            className="font-medium text-accent hover:underline"
          >
            {t('prep.shortfallIncident', { number: line.shortfall_incident.incident_number })}
          </Link>
        </>
      )}
    </p>
  );
}

export function ShortfallEditor({
  line,
  ordered,
  missing,
  required,
  onDone,
}: {
  line: OrderLine;
  ordered: number;
  missing: number;
  /** A started, short line must be explained: no Cancel. */
  required: boolean;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const label = useShortfallLabel();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<ShortfallCode | ''>(line.shortfall_code ?? '');
  const [note, setNote] = useState(line.shortfall_reason ?? '');
  const [report, setReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasReason = Boolean(line.shortfall_code || line.shortfall_reason?.trim());
  const canSave = code !== '' && (code !== 'other' || note.trim().length > 0);

  function run(input: Parameters<typeof setLineShortfall>[0]) {
    setError(null);
    startTransition(async () => {
      const res = await setLineShortfall(input);
      if (!res.ok) {
        setError(ERROR_KEY[res.error] ? t(ERROR_KEY[res.error]) : t('common.error'));
        return;
      }
      onDone();
      router.refresh();
    });
  }

  function save() {
    if (!code) return;
    const trimmed = note.trim();
    const reportNow = report && !line.shortfall_incident;
    const description = [
      t('prep.shortfallIncidentDescription', {
        product: productLabel(line.product),
        missing,
        ordered,
        reason: label(code),
      }),
      trimmed,
    ].filter(Boolean).join('\n');

    run({
      order_line_id: line.id,
      code,
      note: trimmed || null,
      report_incident: reportNow,
      incident_description: reportNow ? description : null,
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-warn/30 bg-warn/[0.06] p-2.5">
      {required && (
        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warn">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {t('prep.shortfallRequired')}
        </p>
      )}

      <Select
        value={code}
        onChange={(e) => setCode(e.target.value as ShortfallCode | '')}
        aria-label={t('prep.shortfallReason')}
        className="text-[13px]"
      >
        <option value="" disabled>{t('prep.shortfallChoose')}</option>
        {SHORTFALL_CODES.map((c) => (
          <option key={c} value={c}>{label(c)}</option>
        ))}
      </Select>

      <NoteTextarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('prep.shortfallNotePlaceholder')}
        rows={1}
        className="min-h-[38px] text-[13px]"
        aria-label={t('prep.shortfallNotePlaceholder')}
      />

      {/* One incident per line: once raised, it is linked instead of offered again. */}
      {line.shortfall_incident ? (
        <Link
          href={`/incidents/${line.shortfall_incident.id}`}
          className="block text-[12px] font-medium text-accent hover:underline"
        >
          {t('prep.shortfallIncident', { number: line.shortfall_incident.incident_number })}
        </Link>
      ) : (
        <Checkbox
          checked={report}
          onChange={(e) => setReport(e.target.checked)}
          label={t('prep.shortfallReportIncident')}
          hint={t('prep.shortfallReportIncidentHint')}
        />
      )}

      {error && <p className="text-[12px] text-late">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={save} loading={pending} disabled={!canSave}>
          {t('prep.saveReason')}
        </Button>
        {!required && (
          <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
            {t('common.cancel')}
          </Button>
        )}
        {hasReason && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={pending}
            onClick={() => run({
              order_line_id: line.id, code: null, note: null, report_incident: false, incident_description: null,
            })}
          >
            {t('prep.clearReason')}
          </Button>
        )}
      </div>
    </div>
  );
}
