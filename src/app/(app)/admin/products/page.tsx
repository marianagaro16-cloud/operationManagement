import { getProducts } from '@/server/orders';
import { ProductManager } from '@/components/admin/product-manager';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const products = await getProducts(true);
  return <ProductManager products={products} />;
}
