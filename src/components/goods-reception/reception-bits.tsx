'use client';

import { useCallback } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { receptionMessageKey } from '@/domain/goods-reception/vocabulary';

/**
 * Small shared pieces of the Goods Reception UI.
 *
 * The error translator is the one that matters: every action in this module
 * returns a stable identifier, and every screen has to turn it into a
 * sentence. Doing that once means a new refusal is translated in one place
 * rather than in five.
 */

/**
 * Turn an action's error identifier into a sentence.
 *
 * An unrecognised code falls through to itself rather than to
 * `gr.error.<postgres text>` — `t()` falls back to the key when a message is
 * missing, so an unlisted database error would otherwise render as a mangled
 * dictionary path and read as a broken screen.
 */
const KNOWN_ERRORS = new Set([
  'not_authorized',
  'not_assigned',
  'invalid_reception',
  'reception_not_found',
  'completed_is_final',
  'backward_not_permitted',
  'already_completed',
  'supplier_required',
  'condition_required',
  'quantity_check_required',
  'discrepancy_needs_explanation',
  'completion_incomplete',
  'invalid_exception',
  'invalid_evidence',
  'evidence_too_large',
  'evidence_type_not_allowed',
  'invalid_name',
  'supplier_exists',
  'transporter_exists',
  'still_referenced',
  'invalid_assignment',
  'invalid_incident',
  'invalid_report',
]);

export function useReceptionError() {
  const { t } = useI18n();
  return useCallback(
    (code: string) => (KNOWN_ERRORS.has(code) ? t(`gr.error.${code}` as MessageKey) : code),
    [t],
  );
}

/**
 * A stored enum value as its translated label.
 *
 * The dictionary holds these flattened to camelCase, because `t()` splits a
 * key on '.' and 'partially_damaged' would otherwise never be found.
 */
export function useReceptionLabels() {
  const { t } = useI18n();

  return {
    status: (value: string) => t(`gr.statusLabel.${receptionMessageKey(value)}` as MessageKey),
    condition: (value: string | null) =>
      value ? t(`gr.conditionLabel.${receptionMessageKey(value)}` as MessageKey) : t('gr.notRecorded'),
    quantity: (value: string) => t(`gr.quantityLabel.${receptionMessageKey(value)}` as MessageKey),
  };
}

/**
 * An audit action as a sentence.
 *
 * The trigger writes a fixed vocabulary of actions, so an unknown one means
 * the database grew an event the UI has not been taught yet. It is shown raw
 * rather than hidden — an untranslated line in the history is a smaller
 * problem than a history with a silent gap in it.
 */
const AUDIT_ACTIONS = new Set([
  'reception_created',
  'reception_status_changed',
  'reception_source_changed',
  'reception_checks_changed',
  'reception_receipt_changed',
  'reception_comments_changed',
  'evidence_added',
  'evidence_removed',
  'exception_added',
  'exception_changed',
  'exception_removed',
]);

export function useAuditLabel() {
  const { t } = useI18n();
  return useCallback(
    (action: string) =>
      AUDIT_ACTIONS.has(action) ? t(`grAudit.${action}` as MessageKey) : action,
    [t],
  );
}

/**
 * Date and time as the operation reads them, pinned to Zurich.
 *
 * `received_at` is one instant; the screen shows two fields because that is
 * how a person thinks about a delivery. Formatting in one place stops the
 * list and the detail page disagreeing about which day a 23:50 arrival was.
 */
export function useReceptionTime() {
  const { locale } = useI18n();

  const date = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Europe/Zurich',
      }).format(new Date(iso)),
    [locale],
  );

  const time = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/Zurich',
      }).format(new Date(iso)),
    [locale],
  );

  return { date, time };
}

/**
 * A timestamp as the value a `datetime-local` input wants.
 *
 * That control speaks local clock time with no zone, so an ISO instant has to
 * be projected into Zurich first — otherwise a machine set to another zone
 * would show, and then save, a different arrival time than the one recorded.
 */
export function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Zurich',
  }).format(new Date(iso));
  // sv-SE gives 'YYYY-MM-DD HH:mm'; the control wants a T.
  return parts.replace(' ', 'T');
}

/**
 * The reverse: a local-clock string back to an instant.
 *
 * Zurich's offset changes twice a year, so it is read from the date itself
 * rather than assumed — a delivery recorded in January and one in July are
 * not an hour apart because of a hardcoded '+01:00'.
 */
export function fromLocalInput(value: string): string {
  // Interpreted as UTC first, then corrected by whatever offset Zurich was on
  // at that moment. Two passes, because the offset depends on the instant.
  const naive = new Date(`${value}:00Z`);
  const offsetMinutes = zurichOffsetMinutes(naive);
  return new Date(naive.getTime() - offsetMinutes * 60_000).toISOString();
}

function zurichOffsetMinutes(at: Date): number {
  const zurich = new Date(
    new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Europe/Zurich',
    })
      .format(at)
      .replace(' ', 'T') + 'Z',
  );
  return Math.round((zurich.getTime() - at.getTime()) / 60_000);
}
