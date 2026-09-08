import { getCustomers, getProducts } from '@/server/orders';
import { getProductAliases } from '@/server/order-import';
import { ProductManager } from '@/components/admin/product-manager';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  // Aliases and the customer list are what the product editor needs to say
  // "this customer calls it that" — the only place those mappings are set.
  const [products, aliases, customers] = await Promise.all([
    getProducts(true),
    getProductAliases(),
    getCustomers(true),
  ]);

  return <ProductManager products={products} aliases={aliases} customers={customers} />;
}
