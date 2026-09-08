import { redirect } from 'next/navigation';
import { getCustomers } from '@/server/orders';
import { getOrderRequestTemplatesWithCustomer } from '@/server/order-import';
import { getViewer } from '@/server/data';
import { OrderTemplateManager } from '@/components/admin/order-template-manager';

export const dynamic = 'force-dynamic';

/**
 * Order Request templates.
 *
 * Order CONFIGURATION, so it takes the same capability the delivery methods
 * and recurring templates take. The admin layout already opens at power_user;
 * this page guards itself, exactly as the other admin-only pages do, because
 * hiding the tab leaves the route reachable by URL. RLS enforces it again.
 */
export default async function OrderTemplatesPage() {
  const viewer = await getViewer();
  if (!viewer?.can('orders.manage_config')) redirect('/dashboard');

  const [templates, customers] = await Promise.all([
    getOrderRequestTemplatesWithCustomer(),
    // Inactive customers are shown here on purpose: a template can outlive a
    // customer's active flag, and hiding it would look like data loss.
    getCustomers(true),
  ]);

  return <OrderTemplateManager templates={templates} customers={customers} />;
}
