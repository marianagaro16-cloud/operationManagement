import { getViewer } from '@/server/data';
import { getCustomers, getCustomerTypes } from '@/server/orders';
import { CustomerManager } from '@/components/admin/customer-manager';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const [customers, customerTypes, viewer] = await Promise.all([
    // Inactive included so an admin can find and reactivate them.
    getCustomers(true),
    getCustomerTypes(),
    getViewer(),
  ]);
  return (
    <CustomerManager
      customers={customers}
      customerTypes={customerTypes}
      reminderViewerId={viewer?.can('reminders.use') ? viewer.profile.id : null}
    />
  );
}
