'use client';

import { useI18n } from '@/i18n';
import { MasterDataManager } from './master-data';
import { saveBrand, saveDeliveryMethod } from '@/server/order-actions';
import type { Brand, DeliveryMethod } from '@/types/orders';

/** Thin client wrapper so the server page stays free of translation calls. */
export function DeliveryMethodsScreen({ methods }: { methods: DeliveryMethod[] }) {
  const { t } = useI18n();
  return (
    <MasterDataManager
      rows={methods}
      title={t('master.methodsTitle')}
      subtitle={t('master.methodsSubtitle')}
      addLabel={t('master.newMethod')}
      save={({ name, slug, is_active }, id) => saveDeliveryMethod(name, slug, is_active, id)}
    />
  );
}

/**
 * Brands.
 *
 * Proper nouns, so no slug and no translation: Masamor is Masamor in every
 * language. Deactivated rather than deleted, and the database refuses to
 * remove one that products still name.
 */
export function BrandsScreen({ brands }: { brands: Brand[] }) {
  const { t } = useI18n();
  return (
    <MasterDataManager
      rows={brands}
      title={t('master.brandsTitle')}
      subtitle={t('master.brandsSubtitle')}
      addLabel={t('master.newBrand')}
      withSlug={false}
      save={({ name, is_active }, id) => saveBrand(name, is_active, id)}
    />
  );
}
