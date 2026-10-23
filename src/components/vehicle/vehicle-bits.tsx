'use client';

import { useCallback } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import type { CostKind } from '@/domain/vehicle/summary';

/* Small shared pieces of the Palomo's screens. */

const KNOWN_ERRORS = new Set([
  'not_authorized',
  'invalid_trip',
  'invalid_cost',
  'vehicle_already_out',
  'vehicle_km_backwards',
  'vehicle_back_before_out',
  'receipt_upload',
]);

export function useVehicleError() {
  const { t } = useI18n();
  return useCallback((code: string) => (KNOWN_ERRORS.has(code) ? t(`palomo.error.${code}` as MessageKey) : code), [t]);
}

export function useCostKindLabel() {
  const { t } = useI18n();
  return useCallback((kind: CostKind) => t(`palomo.kind.${kind}` as MessageKey), [t]);
}

/** "09:41", on the factory's clock. */
export function clock(iso: string): string {
  return new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(new Date(iso));
}

/** "CHF 85.40" */
export function chf(value: number | string): string {
  return `CHF ${Number(value).toFixed(2)}`;
}
