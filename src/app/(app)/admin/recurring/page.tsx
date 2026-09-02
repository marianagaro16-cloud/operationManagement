import { getRecurringTemplates } from '@/server/orders';
import { RecurringManager } from '@/components/admin/recurring-manager';

export const dynamic = 'force-dynamic';

export default async function RecurringPage() {
  const templates = await getRecurringTemplates();
  return <RecurringManager templates={templates} />;
}
