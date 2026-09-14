'use client';

import { useI18n, type MessageKey } from '@/i18n';
import type { CustomerType } from '@/types/orders';

/**
 * A segment's label.
 *
 * The slug is the dictionary key and `name` is the fallback, so a segment
 * added later that no dictionary knows about still renders as something
 * readable rather than as a raw key.
 */
export function useCustomerTypeLabel() {
  const { t } = useI18n();
  return (type: CustomerType | null | undefined) => {
    if (!type) return t('master.typeNone');
    const key = `master.customerType.${type.slug}` as MessageKey;
    const translated = t(key);
    return translated === key ? type.name : translated;
  };
}
