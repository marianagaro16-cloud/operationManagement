import { getViewer } from '@/server/data';
import { getCustomerDetailsMap, getCustomers, getCustomerTypes } from '@/server/orders';
import { CustomerManager } from '@/components/admin/customer-manager';
import { canUseReminders } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const [customers, customerTypes, details, viewer] = await Promise.all([
    // Inactive included so an admin can find and reactivate them.
    getCustomers(true),
    getCustomerTypes(),
    getCustomerDetailsMap(),
    getViewer(),
  ]);
  return (
    <CustomerManager
      customers={customers}
      customerTypes={customerTypes}
      details={details}
      reminderViewerId={viewer && canUseReminders(viewer) ? viewer.profile.id : null}
    />
  );
}
