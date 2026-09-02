import { getDeliveryMethods } from '@/server/orders';
import { DeliveryMethodsScreen } from '@/components/admin/master-screens';

export const dynamic = 'force-dynamic';

export default async function DeliveryMethodsPage() {
  const methods = await getDeliveryMethods(true);
  return <DeliveryMethodsScreen methods={methods} />;
}
