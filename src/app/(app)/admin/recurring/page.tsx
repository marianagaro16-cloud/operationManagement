import {
  getCustomers,
  getDeliveryMethods,
  getProducts,
  getRecurringTemplates,
} from '@/server/orders';
import { RecurringManager } from '@/components/admin/recurring-manager';

export const dynamic = 'force-dynamic';

/**
 * Standing orders.
 *
 * The master data comes along because the screen now CREATES templates, which
 * it never could before — saveTemplate() existed with no caller, so the only
 * way a template arrived was through the Excel importer. Fetched in parallel:
 * none of the four depends on another.
 */
export default async function RecurringPage() {
  const [templates, customers, products, deliveryMethods] = await Promise.all([
    getRecurringTemplates(),
    getCustomers(),
    getProducts(),
    getDeliveryMethods(),
  ]);

  return (
    <RecurringManager
      templates={templates}
      customers={customers}
      products={products}
      deliveryMethods={deliveryMethods}
    />
  );
}
