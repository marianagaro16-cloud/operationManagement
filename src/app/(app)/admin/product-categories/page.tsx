import { redirect } from 'next/navigation';
import { getViewer } from '@/server/data';
import { getProductCategories, getProductSubcategories } from '@/server/orders';
import { ProductCategoriesScreen } from '@/components/admin/product-categories';

export const dynamic = 'force-dynamic';

/**
 * Product categories and subcategories — what the order report groups by.
 *
 * Product master data, so products.manage, like brands. Inactive rows are
 * shown because this is where one is brought back.
 */
export default async function ProductCategoriesPage() {
  const viewer = await getViewer();
  if (!viewer?.can('products.manage')) redirect('/dashboard');

  const [categories, subcategories] = await Promise.all([
    getProductCategories(true),
    getProductSubcategories(true),
  ]);
  return <ProductCategoriesScreen categories={categories} subcategories={subcategories} />;
}
