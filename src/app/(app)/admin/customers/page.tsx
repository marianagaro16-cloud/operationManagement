import { getCustomers, getCustomerTypes } from '@/server/orders';
import { CustomerManager } from '@/components/admin/customer-manager';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const [customers, customerTypes] = await Promise.all([
    // Inactive included so an admin can find and reactivate them.
    getCustomers(true),
    getCustomerTypes(),
  ]);
  return <CustomerManager customers={customers} customerTypes={customerTypes} />;
}
