import { notFound } from 'next/navigation';
import { getUsers } from '@/server/data';
import { getInventoryTemplate } from '@/server/inventory';
import { getProducts } from '@/server/orders';
import { InventoryItemsManager } from '@/components/admin/inventory-items';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryTemplatePage({
  params,
}: {
  params: { templateId: string };
}) {
  const [template, users, products] = await Promise.all([
    getInventoryTemplate(params.templateId),
    getUsers(),
    // The existing product master, reused as-is. Linking an inventory item to
    // a product never creates or edits a product row.
    getProducts(),
  ]);

  if (!template) notFound();

  return (
    <InventoryItemsManager
      template={template}
      items={template.items}
      assigneeIds={template.assignee_ids}
      users={users}
      products={products.map((p) => ({ id: p.id, name: p.name ?? null, code: p.code }))}
    />
  );
}
