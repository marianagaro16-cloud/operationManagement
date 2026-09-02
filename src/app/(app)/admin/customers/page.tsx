import { getCustomers } from '@/server/orders';
import { CustomersScreen } from '@/components/admin/master-screens';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  // Inactive customers are shown so an admin can reactivate them.
  const customers = await getCustomers(true);
  return <CustomersScreen customers={customers} />;
}
