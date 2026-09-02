'use client';

import { useI18n } from '@/i18n';
import { MasterDataManager } from './master-data';
import type { Customer, DeliveryMethod } from '@/types/orders';

/**
 * Thin client wrappers so the server pages stay free of translation calls.
 */

export function CustomersScreen({ customers }: { customers: Customer[] }) {
  const { t } = useI18n();
  return (
    <MasterDataManager
      kind="customer"
      rows={customers}
      title={t('master.customersTitle')}
      subtitle={t('master.customersSubtitle')}
      addLabel={t('master.newCustomer')}
    />
  );
}

export function DeliveryMethodsScreen({ methods }: { methods: DeliveryMethod[] }) {
  const { t } = useI18n();
  return (
    <MasterDataManager
      kind="delivery_method"
      rows={methods}
      title={t('master.methodsTitle')}
      subtitle={t('master.methodsSubtitle')}
      addLabel={t('master.newMethod')}
    />
  );
}
