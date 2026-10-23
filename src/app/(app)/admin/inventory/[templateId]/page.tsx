import { notFound } from 'next/navigation';
import { getUsers, getViewer } from '@/server/data';
import { getSuppliers } from '@/server/goods-reception';
import { getItemSuppliersMap } from '@/server/suppliers';
import { getInventoryTemplate } from '@/server/inventory';
import { getProducts } from '@/server/orders';
import { InventoryItemsManager } from '@/components/admin/inventory-items';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryTemplatePage({
  params,
}: {
  params: { templateId: string };
}) {
  const viewer = await getViewer();
  // Who supplies raw materials and packaging: the office only (2026-10-23).
  const office = viewer?.role === 'owner' || viewer?.role === 'admin' || viewer?.role === 'power_user';
  const [template, users, products, supplierOptions, itemSuppliers] = await Promise.all([
    getInventoryTemplate(params.templateId),
    getUsers(),
    // The existing product master, reused as-is. Linking an inventory item to
    // a product never creates or edits a product row.
    getProducts(),
    office ? getSuppliers(true) : null,
    office ? getItemSuppliersMap() : {},
  ]);

  if (!template) notFound();

  return (
    <InventoryItemsManager
      template={template}
      items={template.items}
      assigneeIds={template.assignee_ids}
      users={users}
      products={products.map((p) => ({ id: p.id, name: p.name ?? null, code: p.code }))}
      supplierOptions={supplierOptions}
      itemSuppliers={itemSuppliers}
    />
  );
}
