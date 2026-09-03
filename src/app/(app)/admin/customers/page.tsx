import { getCustomers } from '@/server/orders';
import { CustomerManager } from '@/components/admin/customer-manager';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  // Inactive included so an admin can find and reactivate them.
  const customers = await getCustomers(true);
  return <CustomerManager customers={customers} />;
}
