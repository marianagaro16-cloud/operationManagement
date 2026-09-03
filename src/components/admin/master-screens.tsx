'use client';

import { useI18n } from '@/i18n';
import { MasterDataManager } from './master-data';
import type { DeliveryMethod } from '@/types/orders';

/** Thin client wrapper so the server page stays free of translation calls. */
export function DeliveryMethodsScreen({ methods }: { methods: DeliveryMethod[] }) {
  const { t } = useI18n();
  return (
    <MasterDataManager
      rows={methods}
      title={t('master.methodsTitle')}
      subtitle={t('master.methodsSubtitle')}
      addLabel={t('master.newMethod')}
    />
  );
}
