import { getInventoryTemplates } from '@/server/inventory';
import { businessToday } from '@/lib/datetime';
import { InventoryTemplateManager } from '@/components/admin/inventory-templates';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryPage() {
  const templates = await getInventoryTemplates();
  return <InventoryTemplateManager templates={templates} today={businessToday()} />;
}
