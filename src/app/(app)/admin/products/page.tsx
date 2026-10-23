import { getViewer } from '@/server/data';
import {
  getBrands,
  getCustomers,
  getProductCategories,
  getProductSubcategories,
  getProducts,
} from '@/server/orders';
import { getProductAliases } from '@/server/order-import';
import { ProductManager } from '@/components/admin/product-manager';
import { getSuppliers } from '@/server/goods-reception';
import { getProductSuppliersMap } from '@/server/suppliers';
import { canUseReminders } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  // Aliases and the customer list are what the product editor needs to say
  // "this customer calls it that" — the only place those mappings are set.
  const viewer = await getViewer();
  // Who supplies each product: the office only (2026-10-23).
  const office = viewer?.role === 'owner' || viewer?.role === 'admin' || viewer?.role === 'power_user';
  const [products, aliases, customers, brands, categories, subcategories, supplierOptions, productSuppliers] = await Promise.all([
    getProducts(true),
    getProductAliases(),
    getCustomers(true),
    // Inactive brands included: a product may still name a retired one, and
    // its own row has to be able to show it.
    getBrands(true),
    getProductCategories(true),
    getProductSubcategories(true),
    office ? getSuppliers(true) : null,
    office ? getProductSuppliersMap() : {},
  ]);

  return (
    <ProductManager
      products={products}
      aliases={aliases}
      customers={customers}
      brands={brands}
      categories={categories}
      subcategories={subcategories}
      supplierOptions={supplierOptions}
      productSuppliers={productSuppliers}
      reminderViewerId={viewer && canUseReminders(viewer) ? viewer.profile.id : null}
    />
  );
}
